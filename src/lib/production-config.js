import { assertProductionAdminAuth } from './admin-auth.js';
import { assertProductionPersistence } from './supabase-server.js';

export function assertProductionRuntime(env = process.env) {
  if (env.NODE_ENV !== 'production') return;

  assertProductionPersistence(env);
  assertProductionAdminAuth(env);
}
