const PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'midway-mcp';
const SERVER_VERSION = '0.1.0';

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;

export function createMcpServer({ registry, store } = {}) {
  if (!registry) throw new Error('MCP server requires a tool registry.');

  async function handleRequest(rpcRequest, { actor } = {}) {
    if (!actor) {
      return rpcError(rpcRequest?.id ?? null, RPC_INVALID_REQUEST, 'Authentication required.');
    }
    if (!rpcRequest || typeof rpcRequest !== 'object' || Array.isArray(rpcRequest)) {
      return rpcError(null, RPC_INVALID_REQUEST, 'Request must be a JSON-RPC object.');
    }
    if (rpcRequest.jsonrpc !== '2.0') {
      return rpcError(rpcRequest.id ?? null, RPC_INVALID_REQUEST, 'jsonrpc must be "2.0".');
    }
    const { id, method, params } = rpcRequest;
    if (!method || typeof method !== 'string') {
      return rpcError(id ?? null, RPC_INVALID_REQUEST, 'method is required.');
    }

    try {
      if (method === 'initialize') return rpcResult(id, initializeResult());
      if (method === 'notifications/initialized') return null;
      if (method === 'ping') return rpcResult(id, {});
      if (method === 'tools/list') return rpcResult(id, await toolsList({ actor }));
      if (method === 'tools/call') return rpcResult(id, await toolsCall({ params, actor }));
      if (method === 'resources/list') return rpcResult(id, { resources: [] });
      if (method === 'prompts/list') return rpcResult(id, { prompts: [] });

      return rpcError(id, RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`);
    } catch (error) {
      const status = error.statusCode || 0;
      if (status === 400 || error.code === 'TOOL_INPUT_INVALID') {
        return rpcError(id, RPC_INVALID_PARAMS, error.message, { details: error.details });
      }
      if (status === 401 || status === 403) {
        return rpcError(id, RPC_INVALID_REQUEST, error.message);
      }
      if (status === 404 || error.code === 'TOOL_NOT_FOUND') {
        return rpcError(id, RPC_METHOD_NOT_FOUND, error.message);
      }
      return rpcError(id, RPC_INTERNAL_ERROR, error.message);
    }
  }

  async function handleBatch(payload, options) {
    if (!Array.isArray(payload)) {
      return handleRequest(payload, options);
    }
    if (payload.length === 0) {
      return rpcError(null, RPC_INVALID_REQUEST, 'Batch must contain at least one request.');
    }
    const responses = await Promise.all(payload.map(item => handleRequest(item, options)));
    const filtered = responses.filter(item => item !== null);
    return filtered.length ? filtered : null;
  }

  function initializeResult() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: 'Midway admin tools. Use tools/list to discover, then tools/call.',
    };
  }

  async function toolsList({ actor }) {
    const tools = registry.list({ actor, store }).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    return { tools };
  }

  async function toolsCall({ params, actor }) {
    if (!params || typeof params !== 'object') {
      throw invalidParams('params must be an object with { name, arguments }.');
    }
    const { name, arguments: args = {}, _meta = {} } = params;
    if (!name || typeof name !== 'string') {
      throw invalidParams('params.name is required.');
    }
    const dryRun = _meta?.dryRun === true || _meta?.dry_run === true;
    const result = await registry.execute(name, {
      input: args ?? {},
      actor,
      store,
      dryRun,
    });
    return {
      content: [
        { type: 'text', text: stringifyResult(result) },
      ],
      structuredContent: result,
      isError: false,
      _meta: dryRun ? { dryRun: true } : undefined,
    };
  }

  return { handleRequest, handleBatch, protocolVersion: PROTOCOL_VERSION };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id, code, message, data = undefined) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function invalidParams(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'TOOL_INPUT_INVALID';
  return error;
}

function stringifyResult(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
