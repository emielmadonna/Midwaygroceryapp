import test from 'node:test';
import assert from 'node:assert/strict';

import { createMcpServer } from '../src/lib/mcp-server.js';
import { createToolRegistry } from '../src/lib/tool-registry.js';

function makeStubStore({ flags = {}, audits = [] } = {}) {
  return {
    flags: () => flags,
    requireFeature(flag) {
      if (flags[flag] === false) {
        const error = new Error(`Feature is disabled: ${flag}`);
        error.code = 'FEATURE_DISABLED';
        error.statusCode = 404;
        throw error;
      }
    },
    async recordAuditLog(entry) {
      audits.push(entry);
    },
  };
}

function buildHarness() {
  const registry = createToolRegistry();
  registry.register({
    name: 'list_things',
    description: 'List things',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: async () => ({ things: ['a', 'b'] }),
  });
  registry.register({
    name: 'echo_input',
    description: 'Echo back the provided string',
    requiredScope: 'write',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['value'],
      additionalProperties: false,
      properties: { value: { type: 'string', minLength: 1 } },
    },
    handler: async ({ input }) => ({ echoed: input.value }),
  });
  registry.register({
    name: 'owner_only',
    description: 'Owner-scoped',
    requiredScope: 'owner',
    sideEffect: 'mutation',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: async () => ({ ok: true }),
  });
  const store = makeStubStore();
  const server = createMcpServer({ registry, store });
  return { server, registry, store };
}

const ownerActor = { role: 'owner', scope: 'owner', actorType: 'api_token' };
const writerActor = { role: 'employee', scope: 'write', actorType: 'api_token' };
const readerActor = { role: 'employee', scope: 'read', actorType: 'api_token' };

test('initialize advertises protocol version and capabilities', async () => {
  const { server } = buildHarness();
  const response = await server.handleRequest(
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { actor: writerActor },
  );
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, '2025-06-18');
  assert.equal(response.result.serverInfo.name, 'midway-mcp');
  assert.ok(response.result.capabilities.tools);
});

test('notifications/initialized returns no response (notification)', async () => {
  const { server } = buildHarness();
  const response = await server.handleRequest(
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { actor: writerActor },
  );
  assert.equal(response, null);
});

test('tools/list filters by actor scope', async () => {
  const { server } = buildHarness();
  const visibleToReader = await server.handleRequest(
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { actor: readerActor },
  );
  assert.deepEqual(visibleToReader.result.tools.map(t => t.name), ['list_things']);

  const visibleToOwner = await server.handleRequest(
    { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    { actor: ownerActor },
  );
  assert.deepEqual(
    visibleToOwner.result.tools.map(t => t.name).sort(),
    ['echo_input', 'list_things', 'owner_only'],
  );
});

test('tools/call returns content with structured result and executes handler', async () => {
  const { server } = buildHarness();
  const response = await server.handleRequest(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo_input', arguments: { value: 'hi' } } },
    { actor: writerActor },
  );
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, false);
  assert.deepEqual(response.result.structuredContent, { echoed: 'hi' });
  assert.ok(response.result.content[0].text.includes('hi'));
});

test('tools/call rejects unknown tool with method_not_found', async () => {
  const { server } = buildHarness();
  const response = await server.handleRequest(
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } },
    { actor: ownerActor },
  );
  assert.equal(response.error.code, -32601);
});

test('tools/call rejects invalid input with invalid_params', async () => {
  const { server } = buildHarness();
  const response = await server.handleRequest(
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo_input', arguments: {} } },
    { actor: writerActor },
  );
  assert.equal(response.error.code, -32602);
});

test('unauthenticated requests are rejected', async () => {
  const { server } = buildHarness();
  const response = await server.handleRequest(
    { jsonrpc: '2.0', id: 7, method: 'tools/list' },
    { actor: null },
  );
  assert.equal(response.error.code, -32600);
});

test('batch requests are handled and notifications stripped from output', async () => {
  const { server } = buildHarness();
  const response = await server.handleBatch([
    { jsonrpc: '2.0', id: 8, method: 'initialize' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 9, method: 'tools/list' },
  ], { actor: writerActor });
  assert.ok(Array.isArray(response));
  assert.equal(response.length, 2);
  assert.equal(response[0].id, 8);
  assert.equal(response[1].id, 9);
});

test('unknown method returns method_not_found', async () => {
  const { server } = buildHarness();
  const response = await server.handleRequest(
    { jsonrpc: '2.0', id: 10, method: 'bogus/method' },
    { actor: ownerActor },
  );
  assert.equal(response.error.code, -32601);
});
