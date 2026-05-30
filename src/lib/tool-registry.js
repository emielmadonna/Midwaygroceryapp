const SCOPE_ORDER = ['read', 'write', 'owner'];

const SIDE_EFFECT_TIERS = new Set(['read', 'mutation', 'destructive']);

export function createToolRegistry() {
  const tools = new Map();

  function register(definition) {
    const tool = normalizeTool(definition);
    if (tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    tools.set(tool.name, tool);
    return tool;
  }

  function get(name) {
    return tools.get(name) || null;
  }

  function list({ actor = null, store = null } = {}) {
    return [...tools.values()]
      .filter(tool => isToolVisible(tool, { actor, store }))
      .map(toPublic);
  }

  async function execute(name, { input = {}, actor, store, audit = true, dryRun = false } = {}) {
    const tool = tools.get(name);
    if (!tool) throw notFoundError(name);

    requireActor(actor);
    requireScope(tool, actor);
    requireFlag(tool, store, actor);

    const validatedInput = validateInput(tool.inputSchema, input);

    if (dryRun && tool.sideEffect !== 'read') {
      return {
        dryRun: true,
        wouldExecute: {
          tool: tool.name,
          sideEffect: tool.sideEffect,
          input: validatedInput,
        },
      };
    }

    const handlerContext = { input: validatedInput, actor, store, dryRun };
    const result = await tool.handler(handlerContext);

    if (audit && !dryRun && tool.sideEffect !== 'read') {
      try {
        await store?.recordAuditLog?.({
          action: `tool.${tool.name}`,
          actor,
          targetType: tool.auditTarget?.type ?? 'tool',
          targetId: tool.auditTarget?.id ?? tool.name,
          metadata: {
            sideEffect: tool.sideEffect,
            actorType: actor?.actorType ?? 'session',
          },
        });
      } catch (error) {
        console.warn('[ToolRegistry] Audit log failed:', error.message);
      }
    }

    return result;
  }

  return { register, get, list, execute };
}

function normalizeTool(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('Tool definition must be an object.');
  }
  const {
    name,
    description = '',
    inputSchema = { type: 'object', properties: {}, additionalProperties: false },
    requiredScope = 'write',
    requiredFlag = null,
    sideEffect = 'mutation',
    handler,
    auditTarget = null,
  } = definition;

  if (!name || typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`Tool name must be lowercase snake_case: ${name}`);
  }
  if (typeof handler !== 'function') {
    throw new Error(`Tool ${name} must have a handler function.`);
  }
  if (!SCOPE_ORDER.includes(requiredScope)) {
    throw new Error(`Tool ${name} has invalid requiredScope: ${requiredScope}`);
  }
  if (!SIDE_EFFECT_TIERS.has(sideEffect)) {
    throw new Error(`Tool ${name} has invalid sideEffect: ${sideEffect}`);
  }

  return Object.freeze({
    name,
    description,
    inputSchema,
    requiredScope,
    requiredFlag,
    sideEffect,
    handler,
    auditTarget,
  });
}

function toPublic(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    requiredScope: tool.requiredScope,
    requiredFlag: tool.requiredFlag,
    sideEffect: tool.sideEffect,
  };
}

function isToolVisible(tool, { actor, store }) {
  if (!actor) return false;
  if (!hasScope(actor, tool.requiredScope)) return false;
  if (tool.requiredFlag && store?.requireFeature) {
    try {
      store.requireFeature(tool.requiredFlag, { role: actor.role });
    } catch {
      return false;
    }
  }
  return true;
}

function requireActor(actor) {
  if (!actor) throw authError('Tool execution requires an authenticated actor.');
}

function requireScope(tool, actor) {
  if (!hasScope(actor, tool.requiredScope)) {
    throw authError(
      `Tool ${tool.name} requires scope ${tool.requiredScope}.`,
      'TOOL_SCOPE_DENIED',
      403,
    );
  }
}

function requireFlag(tool, store, actor) {
  if (!tool.requiredFlag) return;
  if (!store?.requireFeature) return;
  store.requireFeature(tool.requiredFlag, { role: actor?.role ?? null });
}

function hasScope(actor, requiredScope) {
  const actorScope = resolveActorScope(actor);
  return SCOPE_ORDER.indexOf(actorScope) >= SCOPE_ORDER.indexOf(requiredScope);
}

function resolveActorScope(actor) {
  if (!actor) return null;
  if (actor.scope && SCOPE_ORDER.includes(actor.scope)) return actor.scope;
  if (actor.role === 'owner') return 'owner';
  if (actor.role === 'employee') return 'write';
  return 'read';
}

function authError(message, code = 'TOOL_AUTH_REQUIRED', statusCode = 401) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function notFoundError(name) {
  const error = new Error(`Unknown tool: ${name}`);
  error.code = 'TOOL_NOT_FOUND';
  error.statusCode = 404;
  return error;
}

function validateInput(schema, input) {
  const errors = [];
  const value = validateValue(schema, input, '', errors);
  if (errors.length) {
    const error = new Error(`Invalid input: ${errors.join('; ')}`);
    error.code = 'TOOL_INPUT_INVALID';
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }
  return value;
}

function validateValue(schema, value, path, errors) {
  if (!schema) return value;
  if (schema.const !== undefined) {
    if (value !== schema.const) errors.push(`${path || 'value'} must equal ${JSON.stringify(schema.const)}`);
    return value;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path || 'value'} must be one of ${schema.enum.join(', ')}`);
    return value;
  }
  const type = schema.type;
  if (type === 'object') return validateObject(schema, value, path, errors);
  if (type === 'array') return validateArray(schema, value, path, errors);
  if (type === 'string') return validateString(schema, value, path, errors);
  if (type === 'number' || type === 'integer') return validateNumber(schema, value, path, errors, type === 'integer');
  if (type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path || 'value'} must be boolean`);
    return value;
  }
  return value;
}

function validateObject(schema, value, path, errors) {
  if (value == null) {
    if (schema.nullable) return value;
    errors.push(`${path || 'value'} must be an object`);
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path || 'value'} must be an object`);
    return {};
  }
  const result = {};
  const properties = schema.properties || {};
  const required = schema.required || [];
  for (const key of required) {
    if (!(key in value)) errors.push(`${joinPath(path, key)} is required`);
  }
  for (const [key, propValue] of Object.entries(value)) {
    if (properties[key]) {
      result[key] = validateValue(properties[key], propValue, joinPath(path, key), errors);
    } else if (schema.additionalProperties === false) {
      errors.push(`${joinPath(path, key)} is not allowed`);
    } else {
      result[key] = propValue;
    }
  }
  for (const [key, propSchema] of Object.entries(properties)) {
    if (!(key in result) && propSchema.default !== undefined) {
      result[key] = propSchema.default;
    }
  }
  return result;
}

function validateArray(schema, value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path || 'value'} must be an array`);
    return [];
  }
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    errors.push(`${path || 'value'} must have at least ${schema.minItems} items`);
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    errors.push(`${path || 'value'} must have at most ${schema.maxItems} items`);
  }
  if (!schema.items) return value;
  return value.map((item, index) => validateValue(schema.items, item, `${path}[${index}]`, errors));
}

function validateString(schema, value, path, errors) {
  if (typeof value !== 'string') {
    errors.push(`${path || 'value'} must be a string`);
    return '';
  }
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    errors.push(`${path || 'value'} must be at least ${schema.minLength} characters`);
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    errors.push(`${path || 'value'} must be at most ${schema.maxLength} characters`);
  }
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path || 'value'} must match pattern ${schema.pattern}`);
  }
  return value;
}

function validateNumber(schema, value, path, errors, integer) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    errors.push(`${path || 'value'} must be a number`);
    return value;
  }
  if (integer && !Number.isInteger(value)) {
    errors.push(`${path || 'value'} must be an integer`);
  }
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    errors.push(`${path || 'value'} must be >= ${schema.minimum}`);
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    errors.push(`${path || 'value'} must be <= ${schema.maximum}`);
  }
  return value;
}

function joinPath(parent, key) {
  if (!parent) return key;
  return `${parent}.${key}`;
}
