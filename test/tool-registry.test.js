import test from 'node:test';
import assert from 'node:assert/strict';

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

test('registry rejects duplicate tool names', () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'demo',
    sideEffect: 'read',
    requiredScope: 'read',
    handler: async () => ({}),
  });
  assert.throws(() => registry.register({
    name: 'demo',
    sideEffect: 'read',
    requiredScope: 'read',
    handler: async () => ({}),
  }), /already registered/);
});

test('registry requires lowercase snake_case names', () => {
  const registry = createToolRegistry();
  assert.throws(() => registry.register({
    name: 'BadName',
    sideEffect: 'read',
    requiredScope: 'read',
    handler: async () => ({}),
  }), /snake_case/);
});

test('list filters by actor scope and feature flag', () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'public_thing',
    sideEffect: 'read',
    requiredScope: 'read',
    handler: async () => ({}),
  });
  registry.register({
    name: 'owner_thing',
    sideEffect: 'mutation',
    requiredScope: 'owner',
    handler: async () => ({}),
  });
  registry.register({
    name: 'gated_thing',
    sideEffect: 'mutation',
    requiredScope: 'write',
    requiredFlag: 'feature.off',
    handler: async () => ({}),
  });

  const store = makeStubStore({ flags: { 'feature.off': false } });
  const employee = { role: 'employee' };
  const visible = registry.list({ actor: employee, store }).map(tool => tool.name);
  assert.deepEqual(visible, ['public_thing']);
});

test('execute denies missing actor and wrong scope', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'owner_op',
    sideEffect: 'mutation',
    requiredScope: 'owner',
    handler: async () => ({ ok: true }),
  });

  await assert.rejects(
    registry.execute('owner_op', { input: {}, actor: null, store: makeStubStore() }),
    /actor/,
  );
  await assert.rejects(
    registry.execute('owner_op', { input: {}, actor: { role: 'employee' }, store: makeStubStore() }),
    /scope/,
  );
});

test('execute validates input schema and surfaces errors', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'do_thing',
    sideEffect: 'mutation',
    requiredScope: 'write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 2 },
        count: { type: 'integer', minimum: 0 },
      },
    },
    handler: async ({ input }) => input,
  });

  await assert.rejects(
    registry.execute('do_thing', { input: { count: -1 }, actor: { role: 'owner' }, store: makeStubStore() }),
    /name|count/,
  );
});

test('execute calls handler and emits audit on mutation', async () => {
  const audits = [];
  const store = makeStubStore({ audits });
  const registry = createToolRegistry();
  registry.register({
    name: 'do_write',
    sideEffect: 'mutation',
    requiredScope: 'write',
    inputSchema: { type: 'object', additionalProperties: false, properties: { v: { type: 'string' } } },
    handler: async ({ input }) => ({ echoed: input.v }),
  });
  const result = await registry.execute('do_write', {
    input: { v: 'hi' },
    actor: { role: 'owner', actorType: 'api_token' },
    store,
  });
  assert.deepEqual(result, { echoed: 'hi' });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'tool.do_write');
  assert.equal(audits[0].metadata.actorType, 'api_token');
});

test('execute does not emit audit for read tools', async () => {
  const audits = [];
  const store = makeStubStore({ audits });
  const registry = createToolRegistry();
  registry.register({
    name: 'do_read',
    sideEffect: 'read',
    requiredScope: 'read',
    handler: async () => ({ ok: true }),
  });
  await registry.execute('do_read', { input: {}, actor: { role: 'employee' }, store });
  assert.equal(audits.length, 0);
});

test('execute enforces feature flag at call time', async () => {
  const store = makeStubStore({ flags: { 'thing.enabled': false } });
  const registry = createToolRegistry();
  registry.register({
    name: 'guarded',
    sideEffect: 'mutation',
    requiredScope: 'write',
    requiredFlag: 'thing.enabled',
    handler: async () => ({ ok: true }),
  });
  await assert.rejects(
    registry.execute('guarded', { input: {}, actor: { role: 'owner' }, store }),
    /thing\.enabled/,
  );
});
