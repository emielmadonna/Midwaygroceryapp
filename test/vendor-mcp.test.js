import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';

import { createVendorMcpClient, validateMcpEndpoint } from '../src/lib/vendor-mcp.js';

test('vendor MCP endpoints require HTTPS except for local development', () => {
  assert.equal(validateMcpEndpoint('https://vendors.example.com/mcp').toString(), 'https://vendors.example.com/mcp');
  assert.equal(validateMcpEndpoint('http://localhost:8787/mcp', { env: { NODE_ENV: 'test' } }).hostname, 'localhost');
  assert.throws(
    () => validateMcpEndpoint('http://vendors.example.com/mcp', { env: { NODE_ENV: 'test' } }),
    error => error.code === 'VENDOR_MCP_URL_UNSAFE',
  );
  assert.throws(
    () => validateMcpEndpoint('https://127.0.0.1/mcp', { env: { NODE_ENV: 'production' } }),
    error => error.code === 'VENDOR_MCP_URL_PRIVATE',
  );
});

test('named local MCP servers resolve only from server configuration', () => {
  const local = validateMcpEndpoint('stdio://private-vendor', {
    env: { NODE_ENV: 'test', VENDOR_MCP_STDIO_PRIVATE_VENDOR_PATH: process.execPath },
  });
  assert.equal(local.toString(), 'stdio://private-vendor');
  assert.throws(
    () => validateMcpEndpoint('stdio://private-vendor', { env: { NODE_ENV: 'test' } }),
    error => error.code === 'VENDOR_MCP_STDIO_NOT_CONFIGURED',
  );
  assert.throws(
    () => validateMcpEndpoint('stdio://private-vendor', { env: { NODE_ENV: 'production' } }),
    error => error.code === 'VENDOR_MCP_STDIO_UNAVAILABLE',
  );
  assert.equal(
    validateMcpEndpoint('stdio://harborhub', { env: { NODE_ENV: 'production' } }).toString(),
    'stdio://harborhub',
  );
});

test('login credentials are rejected for remote MCP endpoints', () => {
  assert.throws(
    () => createVendorMcpClient({
      endpointUrl: 'https://vendors.example.com/mcp',
      credentials: { email: 'owner@midway.test', password: 'secret' },
      env: { NODE_ENV: 'test' },
    }),
    error => error.code === 'VENDOR_MCP_LOGIN_UNSUPPORTED',
  );
});

test('vendor MCP client supports SSE tool responses and bearer credentials', async () => {
  const seen = [];
  const client = createVendorMcpClient({
    endpointUrl: 'https://vendors.example.com/mcp',
    authToken: 'vendor-token',
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      seen.push({ method: request.method, authorization: options.headers.Authorization });
      const result = request.method === 'tools/list' ? { tools: [{ name: 'catalog.search' }] } : {};
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });

  assert.deepEqual(await client.listTools(), [{ name: 'catalog.search' }]);
  assert.deepEqual(seen.map(item => item.method), ['initialize', 'notifications/initialized', 'tools/list']);
  assert.ok(seen.every(item => item.authorization === 'Bearer vendor-token'));
});

test('vendor MCP client preserves the server session across initialize and tool calls', async () => {
  const seen = [];
  const client = createVendorMcpClient({
    endpointUrl: 'https://vendors.example.com/mcp',
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      seen.push({ method: request.method, sessionId: options.headers['Mcp-Session-Id'] || null });
      const result = request.method === 'tools/list' ? { tools: [{ name: 'orders.create' }] } : {};
      return new Response(request.id ? JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) : '', {
        status: request.id ? 200 : 202,
        headers: { 'content-type': 'application/json', ...(request.method === 'initialize' ? { 'Mcp-Session-Id': 'session-123' } : {}) },
      });
    },
  });

  assert.deepEqual(await client.listTools(), [{ name: 'orders.create' }]);
  assert.deepEqual(seen, [
    { method: 'initialize', sessionId: null },
    { method: 'notifications/initialized', sessionId: 'session-123' },
    { method: 'tools/list', sessionId: 'session-123' },
  ]);
});
