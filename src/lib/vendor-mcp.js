import crypto from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const stdioConnections = new Map();
const require = createRequire(import.meta.url);

export function createVendorMcpClient({
  endpointUrl,
  authToken = '',
  credentials = null,
  fetchImpl = globalThis.fetch,
  env = process.env,
  timeoutMs = 12_000,
} = {}) {
  const endpoint = validateMcpEndpoint(endpointUrl, { env });
  if (endpoint.protocol === 'stdio:') {
    return createStdioVendorMcpClient({ endpoint, env, timeoutMs, credentials });
  }
  if (credentials) {
    throw mcpError('VENDOR_MCP_LOGIN_UNSUPPORTED', 'Email and password sign-in only works with the built-in Harbor connection.', 400);
  }
  let sessionId = '';
  let initialized = null;

  async function request(method, params = undefined, { notification = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestId = notification ? null : crypto.randomUUID();
    try {
      const response = await fetchImpl(endpoint.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          ...(notification ? {} : { id: requestId }),
          method,
          ...(params === undefined ? {} : { params }),
        }),
        signal: controller.signal,
      });
      const returnedSessionId = response.headers?.get?.('mcp-session-id');
      if (returnedSessionId) sessionId = returnedSessionId;
      const payload = await parseMcpResponse(response, { requestId });
      if (!response.ok) {
        throw mcpError('VENDOR_MCP_HTTP_ERROR', payload?.error?.message || `Vendor MCP returned ${response.status}.`, 502);
      }
      if (payload?.error) {
        throw mcpError('VENDOR_MCP_REMOTE_ERROR', payload.error.message || 'Vendor MCP call failed.', 502);
      }
      return payload?.result ?? {};
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw mcpError('VENDOR_MCP_TIMEOUT', 'The vendor connection timed out.', 504);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    endpoint: endpoint.toString(),
    async initialize() {
      if (!initialized) {
        initialized = (async () => {
          const result = await request('initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'midway-command-center', version: '1.0.0' },
          });
          await request('notifications/initialized', undefined, { notification: true });
          return result;
        })().catch(error => {
          initialized = null;
          sessionId = '';
          throw error;
        });
      }
      return initialized;
    },
    async listTools() {
      await this.initialize();
      const result = await request('tools/list', {});
      return result.tools ?? [];
    },
    async callTool(name, args = {}) {
      if (!name || typeof name !== 'string') {
        throw mcpError('VENDOR_MCP_TOOL_REQUIRED', 'A vendor tool name is required.', 400);
      }
      await this.initialize();
      return request('tools/call', { name, arguments: args });
    },
  };
}

export function validateMcpEndpoint(value, { env = process.env } = {}) {
  let endpoint;
  try {
    endpoint = new URL(String(value || '').trim());
  } catch {
    throw mcpError('VENDOR_MCP_URL_INVALID', 'Enter a valid MCP server URL.', 400);
  }

  if (endpoint.protocol === 'stdio:') {
    if (env.NODE_ENV === 'production' && endpoint.hostname !== 'harborhub') {
      throw mcpError('VENDOR_MCP_STDIO_UNAVAILABLE', 'Local MCP servers are not available in the hosted environment.', 409);
    }
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(endpoint.hostname)) {
      throw mcpError('VENDOR_MCP_STDIO_ALIAS_INVALID', 'Choose a configured local MCP server name.', 400);
    }
    resolveStdioServerPath(endpoint.hostname, env);
    endpoint.pathname = '';
    endpoint.search = '';
    endpoint.hash = '';
    return endpoint;
  }

  const isLocalDevelopment = env.NODE_ENV !== 'production'
    && ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && isLocalDevelopment)) {
    throw mcpError('VENDOR_MCP_URL_UNSAFE', 'Vendor MCP servers must use HTTPS.', 400);
  }

  if (env.NODE_ENV === 'production' && isPrivateHostname(endpoint.hostname)) {
    throw mcpError('VENDOR_MCP_URL_PRIVATE', 'Private network MCP endpoints are not allowed in production.', 400);
  }
  endpoint.hash = '';
  return endpoint;
}

function createStdioVendorMcpClient({ endpoint, env, timeoutMs, credentials = null }) {
  const alias = endpoint.hostname.toLowerCase();
  const serverPath = resolveStdioServerPath(alias, env);
  const credentialFingerprint = credentials
    ? crypto.createHash('sha256').update(`${credentials.email}\n${credentials.password}`).digest('hex').slice(0, 16)
    : 'env';
  const connectionKey = `${alias}:${serverPath}:${credentialFingerprint}`;

  async function connection() {
    if (!stdioConnections.has(connectionKey)) {
      closeStaleStdioConnections(`${alias}:${serverPath}:`, connectionKey);
      const pending = (async () => {
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: [serverPath],
          cwd: path.dirname(serverPath),
          env: harborProcessEnvironment(env, credentials),
          stderr: 'pipe',
        });
        const client = new Client(
          { name: 'midway-command-center', version: '1.0.0' },
          { capabilities: {} },
        );
        await client.connect(transport, { timeout: timeoutMs });
        return { client, transport };
      })().catch(error => {
        stdioConnections.delete(connectionKey);
        throw normalizeStdioError(error);
      });
      stdioConnections.set(connectionKey, pending);
    }
    return stdioConnections.get(connectionKey);
  }

  async function run(operation) {
    try {
      const active = await connection();
      return await operation(active.client);
    } catch (error) {
      stdioConnections.delete(connectionKey);
      throw normalizeStdioError(error);
    }
  }

  return {
    endpoint: endpoint.toString(),
    async initialize() {
      const active = await connection();
      return {
        serverInfo: active.client.getServerVersion(),
        capabilities: active.client.getServerCapabilities(),
      };
    },
    async listTools() {
      const result = await run(client => client.listTools({}, { timeout: timeoutMs }));
      return result.tools ?? [];
    },
    async callTool(name, args = {}) {
      if (!name || typeof name !== 'string') {
        throw mcpError('VENDOR_MCP_TOOL_REQUIRED', 'A vendor tool name is required.', 400);
      }
      return run(client => client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: timeoutMs },
      ));
    },
  };
}

function resolveStdioServerPath(alias, env) {
  const envKey = `VENDOR_MCP_STDIO_${String(alias || '').replaceAll('-', '_').toUpperCase()}_PATH`;
  const configured = String(
    env.NODE_ENV === 'production'
      ? (alias === 'harborhub' ? bundledHarborServerPath() : '')
      : env[envKey]
        || (alias === 'harborhub' ? env.HARBOR_MCP_SERVER_PATH || bundledHarborServerPath() : '')
      || '',
  ).trim();
  if (!configured) {
    throw mcpError('VENDOR_MCP_STDIO_NOT_CONFIGURED', `The local ${alias} MCP server path is not configured.`, 409);
  }
  try {
    const resolved = realpathSync(configured);
    if (!statSync(resolved).isFile()) throw new Error('not a file');
    return resolved;
  } catch {
    throw mcpError('VENDOR_MCP_STDIO_NOT_FOUND', `The configured local ${alias} MCP server could not be found.`, 409);
  }
}

function bundledHarborServerPath() {
  try {
    return require.resolve('harborhub-mcp');
  } catch {
    return '';
  }
}

function harborProcessEnvironment(env, credentials = null) {
  return {
    ...getDefaultEnvironment(),
    ...Object.fromEntries(
      Object.entries(env || {})
        .filter(([key, value]) => key.startsWith('HARBOR_') && value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)]),
    ),
    ...(credentials ? { HARBOR_EMAIL: String(credentials.email), HARBOR_PASSWORD: String(credentials.password) } : {}),
  };
}

function closeStaleStdioConnections(keyPrefix, activeKey) {
  for (const [key, pending] of stdioConnections) {
    if (key === activeKey || !key.startsWith(keyPrefix)) continue;
    stdioConnections.delete(key);
    pending.then(active => active.transport.close()).catch(() => {});
  }
}

function normalizeStdioError(error) {
  if (error?.code?.startsWith?.('VENDOR_MCP_')) return error;
  if (error?.code === -32001 || /timeout/i.test(String(error?.message || ''))) {
    return mcpError('VENDOR_MCP_TIMEOUT', 'The local vendor connection timed out.', 504);
  }
  return mcpError('VENDOR_MCP_LOCAL_ERROR', error?.message || 'The local vendor MCP server failed.', 502);
}

async function parseMcpResponse(response, { requestId } = {}) {
  if (response.status === 202 || response.status === 204) return {};
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const body = await response.text();
    const messages = body
      .replaceAll('\r\n', '\n')
      .split('\n\n')
      .map(block => block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))
      .filter(data => data && data !== '[DONE]')
      .map(data => JSON.parse(data));
    if (!messages.length) return {};
    return messages.find(message => requestId && message.id === requestId) ?? messages.at(-1);
  }
  return response.json().catch(() => ({}));
}

function isPrivateHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  if (value === 'localhost' || value.endsWith('.local')) return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value)) return true;
  const match = value.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return value === '::1' || value.startsWith('fc') || value.startsWith('fd');
}

function mcpError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
