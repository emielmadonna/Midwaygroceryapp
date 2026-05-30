import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdempotencyMiddleware, createIdempotencyService, isWriteMethod } from '../src/lib/idempotency.js';
import { createMcpServer } from '../src/lib/mcp-server.js';
import { createToolRegistry } from '../src/lib/tool-registry.js';

test('isWriteMethod recognizes POST/PUT/PATCH/DELETE only', () => {
  assert.equal(isWriteMethod('GET'), false);
  assert.equal(isWriteMethod('POST'), true);
  assert.equal(isWriteMethod('PATCH'), true);
  assert.equal(isWriteMethod('PUT'), true);
  assert.equal(isWriteMethod('DELETE'), true);
  assert.equal(isWriteMethod('OPTIONS'), false);
});

test('disabled service short-circuits', async () => {
  const service = createIdempotencyService({ supabase: null });
  assert.equal(await service.find({ key: 'k', route: '/x', method: 'POST' }), null);
  await service.record({ key: 'k', route: '/x', method: 'POST', statusCode: 200, responseBody: {} });
});

test('idempotency middleware replays cached responses', async () => {
  const stored = new Map();
  const service = {
    async find({ tenantId, actorId, key, route, method }) {
      return stored.get([tenantId, actorId, key, route, method].join('|')) ?? null;
    },
    async record({ tenantId, actorId, key, route, method, statusCode, responseBody }) {
      stored.set([tenantId, actorId, key, route, method].join('|'), {
        status_code: statusCode,
        response_body: responseBody,
        expires_at: new Date(Date.now() + 86400_000).toISOString(),
      });
    },
  };
  const middleware = createIdempotencyMiddleware({ service, tenantId: 'midway' });

  const recorded = [];
  const reqFactory = () => ({
    method: 'POST',
    path: '/test',
    baseUrl: '/admin',
    adminUser: { id: 'u1' },
    get(name) {
      if (String(name).toLowerCase() === 'idempotency-key') return 'KEY1';
      return null;
    },
  });
  const resFactory = () => {
    const handlers = {};
    return {
      statusCode: 200,
      setHeader: () => {},
      on(event, fn) { handlers[event] = fn; },
      status(code) { this.statusCode = code; return this; },
      json(body) { recorded.push({ statusCode: this.statusCode, body }); handlers.finish?.(); return this; },
    };
  };

  await middleware(reqFactory(), resFactory(), () => {
    // simulate handler
    const res = recorded.__lastResProxy;
    res?.json?.({ ok: true, data: { value: 42 } });
  });
  // Manually simulate writing: call res.json then finish
  const res1 = resFactory();
  await middleware(reqFactory(), res1, () => {
    res1.status(201).json({ ok: true, data: { v: 1 } });
  });

  const replayed = [];
  const replayedRes = {
    statusCode: 200,
    setHeader: () => {},
    on: () => {},
    status(code) { this.statusCode = code; return this; },
    json(body) { replayed.push({ statusCode: this.statusCode, body }); return this; },
  };
  await middleware(reqFactory(), replayedRes, () => {
    throw new Error('handler should not run on replay');
  });
  assert.equal(replayed[0]?.body?.data?.v, 1);
});

test('registry dryRun returns plan without executing', async () => {
  const registry = createToolRegistry();
  let executed = false;
  registry.register({
    name: 'do_write',
    requiredScope: 'write',
    sideEffect: 'mutation',
    inputSchema: { type: 'object', additionalProperties: false, required: ['v'], properties: { v: { type: 'string' } } },
    handler: async () => { executed = true; return { ok: true }; },
  });
  const result = await registry.execute('do_write', { input: { v: 'x' }, actor: { role: 'owner' }, dryRun: true });
  assert.equal(executed, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.wouldExecute.tool, 'do_write');
});

test('registry dryRun still runs read tools', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'do_read',
    requiredScope: 'read',
    sideEffect: 'read',
    handler: async () => ({ value: 7 }),
  });
  const result = await registry.execute('do_read', { input: {}, actor: { role: 'employee' }, dryRun: true });
  assert.deepEqual(result, { value: 7 });
});

test('MCP tools/call honors _meta.dryRun', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'set_thing',
    requiredScope: 'write',
    sideEffect: 'mutation',
    inputSchema: { type: 'object', additionalProperties: false, properties: { value: { type: 'string' } } },
    handler: async () => ({ should: 'not run' }),
  });
  const server = createMcpServer({ registry, store: { flags: () => ({}) } });
  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'set_thing', arguments: { value: 'x' }, _meta: { dryRun: true } },
  }, { actor: { role: 'owner', scope: 'owner' } });
  assert.equal(response.result.structuredContent.dryRun, true);
});
