CREATE TABLE IF NOT EXISTS admin_api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'midway',
  location_id TEXT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'write' CHECK (scope IN ('read', 'write', 'owner')),
  created_by_email TEXT,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_api_tokens_tenant_idx
  ON admin_api_tokens (tenant_id, location_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS admin_api_tokens_lookup_idx
  ON admin_api_tokens (token_hash)
  WHERE revoked_at IS NULL;
