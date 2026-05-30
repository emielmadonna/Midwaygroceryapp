CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'midway',
  actor_id TEXT,
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, actor_id, key, route, method)
);

CREATE INDEX IF NOT EXISTS idempotency_keys_lookup_idx
  ON idempotency_keys (tenant_id, actor_id, key, expires_at);

CREATE INDEX IF NOT EXISTS idempotency_keys_expiry_idx
  ON idempotency_keys (expires_at);
