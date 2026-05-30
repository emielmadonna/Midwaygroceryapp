import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiTokenService, hashToken } from '../src/lib/api-tokens.js';

function makeStubSupabase() {
  const rows = [];
  const last = { selectFilter: null };

  const buildQuery = (table) => {
    let context = {
      filter: {},
      mode: null,
      payload: null,
      selectColumns: '*',
      orderColumn: null,
      orderAscending: true,
      isNullColumn: null,
    };
    const exec = async () => {
      let filtered = rows.filter(row => row._table === table);
      for (const [key, value] of Object.entries(context.filter)) {
        filtered = filtered.filter(row => row[key] === value);
      }
      if (context.isNullColumn) {
        filtered = filtered.filter(row => row[context.isNullColumn] == null);
      }
      if (context.orderColumn) {
        filtered = [...filtered].sort((a, b) => {
          const dir = context.orderAscending ? 1 : -1;
          return ((a[context.orderColumn] ?? 0) > (b[context.orderColumn] ?? 0) ? 1 : -1) * dir;
        });
      }
      if (context.mode === 'insert') {
        const created = { ...context.payload, _table: table, id: cryptoId(), created_at: new Date().toISOString() };
        rows.push(created);
        return { data: created, error: null };
      }
      if (context.mode === 'update') {
        for (const row of filtered) {
          Object.assign(row, context.payload);
        }
        return { data: filtered[0] ?? null, error: null };
      }
      return { data: filtered, error: null };
    };

    const queryApi = {
      select(columns) {
        context.selectColumns = columns;
        return queryApi;
      },
      eq(column, value) {
        context.filter[column] = value;
        return queryApi;
      },
      is(column, value) {
        if (value == null) context.isNullColumn = column;
        return queryApi;
      },
      order(column, { ascending = true } = {}) {
        context.orderColumn = column;
        context.orderAscending = ascending;
        return queryApi;
      },
      insert(payload) {
        context.mode = 'insert';
        context.payload = Array.isArray(payload) ? payload[0] : payload;
        return queryApi;
      },
      update(payload) {
        context.mode = 'update';
        context.payload = payload;
        return queryApi;
      },
      async single() { return exec(); },
      async maybeSingle() {
        const result = await exec();
        if (Array.isArray(result.data)) {
          return { data: result.data[0] ?? null, error: result.error };
        }
        return result;
      },
      then(onFulfilled, onRejected) {
        return exec().then(onFulfilled, onRejected);
      },
    };
    return queryApi;
  };

  return {
    from: buildQuery,
    _rows: rows,
    _last: last,
  };
}

function cryptoId() {
  return Math.random().toString(36).slice(2, 10);
}

test('mint creates a token with hashed storage and returns plaintext once', async () => {
  const supabase = makeStubSupabase();
  const tokens = createApiTokenService({ supabase, env: { NODE_ENV: 'test' } });
  const { token, record } = await tokens.mint({ name: 'Slack bot' });
  assert.ok(token.startsWith('mw_test_'));
  assert.equal(record.tokenPrefix, token.slice(0, 12));
  assert.equal(record.name, 'Slack bot');
  assert.equal(record.scope, 'write');

  const stored = supabase._rows[0];
  assert.equal(stored.token_hash, hashToken(token));
  assert.ok(!('token' in stored));
});

test('authenticate returns actor with derived role and rejects unknown', async () => {
  const supabase = makeStubSupabase();
  const tokens = createApiTokenService({ supabase, env: { NODE_ENV: 'test' } });
  const { token } = await tokens.mint({ name: 'Owner key', scope: 'owner' });

  const actor = await tokens.authenticate(token);
  assert.equal(actor.actorType, 'api_token');
  assert.equal(actor.scope, 'owner');
  assert.equal(actor.role, 'owner');
  assert.equal(actor.name, 'Owner key');

  const denied = await tokens.authenticate('mw_test_garbage');
  assert.equal(denied, null);

  const wrongPrefix = await tokens.authenticate('sk-not-ours');
  assert.equal(wrongPrefix, null);
});

test('revoke prevents subsequent authentication', async () => {
  const supabase = makeStubSupabase();
  const tokens = createApiTokenService({ supabase, env: { NODE_ENV: 'test' } });
  const { token, record } = await tokens.mint({ name: 'doomed' });
  await tokens.revoke({ id: record.id });
  const actor = await tokens.authenticate(token);
  assert.equal(actor, null);
});

test('mint rejects bad scope and bad name', async () => {
  const supabase = makeStubSupabase();
  const tokens = createApiTokenService({ supabase, env: { NODE_ENV: 'test' } });
  await assert.rejects(tokens.mint({ name: 'ok', scope: 'admin' }), /scope/);
  await assert.rejects(tokens.mint({ name: '' }), /name/);
});

test('expired tokens are not authenticated', async () => {
  const supabase = makeStubSupabase();
  const tokens = createApiTokenService({ supabase, env: { NODE_ENV: 'test' } });
  const { token } = await tokens.mint({ name: 'expired', expiresAt: new Date(Date.now() - 1000).toISOString() });
  const actor = await tokens.authenticate(token);
  assert.equal(actor, null);
});

test('service returns disabled stub when supabase missing', async () => {
  const tokens = createApiTokenService({ supabase: null });
  assert.deepEqual(await tokens.list(), []);
  assert.equal(await tokens.authenticate('mw_live_anything'), null);
  await assert.rejects(tokens.mint({ name: 'x' }), /Supabase/);
});
