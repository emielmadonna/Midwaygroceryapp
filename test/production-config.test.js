import test from 'node:test';
import assert from 'node:assert/strict';

import { hashAdminPassword } from '../src/lib/admin-auth.js';
import { assertProductionRuntime } from '../src/lib/production-config.js';
import { assertProductionPersistence, getSupabaseServerConfig } from '../src/lib/supabase-server.js';

test('server Supabase config requires a service role key for persistence', () => {
  assert.deepEqual(getSupabaseServerConfig({}), {
    url: undefined,
    serviceRoleKey: undefined,
    configured: false,
    invalidUrl: false,
  });
  assert.deepEqual(getSupabaseServerConfig({
    NEXT_PUBLIC_SUPABASE_URL: 'https://midway.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }), {
    url: 'https://midway.supabase.co',
    serviceRoleKey: 'service-role',
    configured: true,
    invalidUrl: false,
  });
  assert.deepEqual(getSupabaseServerConfig({
    NEXT_PUBLIC_SUPABASE_URL: 'your-project-url',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }), {
    url: 'your-project-url',
    serviceRoleKey: 'service-role',
    configured: false,
    invalidUrl: true,
  });
});

test('production runtime fails fast without platform persistence and admin auth', () => {
  assert.throws(
    () => assertProductionPersistence({ NODE_ENV: 'production' }),
    /Supabase persistence is required in production/,
  );

  assert.throws(() => assertProductionRuntime({
    NODE_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://midway.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }), /at least one owner admin user is required/);
});

test('production runtime accepts platform config without tenant provider variables', () => {
  assert.doesNotThrow(() => assertProductionRuntime({
    NODE_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://midway.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    ADMIN_OWNER_EMAIL: 'owner@midway.local',
    ADMIN_OWNER_PASSWORD_HASH: hashAdminPassword('owner-pass', { salt: 'abcd', iterations: 10 }),
    ADMIN_SESSION_SECRET: 'session-secret',
  }));
});
