-- Midway Command Center: vendor-aware inventory, ordering, receiving, and reconciliation.

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'inactive')),
  ordering_method TEXT NOT NULL DEFAULT 'manual' CHECK (ordering_method IN ('mcp', 'api', 'portal', 'email', 'manual')),
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  order_day TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  connector_type TEXT NOT NULL DEFAULT 'mcp' CHECK (connector_type IN ('mcp', 'api', 'edi', 'email', 'manual')),
  transport TEXT NOT NULL DEFAULT 'streamable_http' CHECK (transport IN ('streamable_http', 'sse')),
  endpoint_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'bearer' CHECK (auth_type IN ('none', 'bearer', 'oauth')),
  secret_ref TEXT,
  encrypted_credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'not_tested' CHECK (status IN ('not_tested', 'connected', 'degraded', 'error', 'disabled')),
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_checked_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_id, display_name)
);

ALTER TABLE vendor_connectors
  ADD COLUMN IF NOT EXISTS encrypted_credentials JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS inventory_balances (
  square_variation_id TEXT PRIMARY KEY,
  location_id TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  reorder_point NUMERIC,
  target_stock NUMERIC,
  source TEXT NOT NULL DEFAULT 'square',
  last_counted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (reorder_point IS NULL OR reorder_point >= 0),
  CHECK (target_stock IS NULL OR target_stock >= 0)
);

CREATE TABLE IF NOT EXISTS vendor_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  square_variation_id TEXT NOT NULL,
  vendor_sku TEXT,
  case_pack INTEGER,
  unit_cost_cents INTEGER,
  minimum_order_quantity INTEGER,
  lead_time_days INTEGER,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_id, square_variation_id),
  CHECK (case_pack IS NULL OR case_pack > 0),
  CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  connector_id UUID REFERENCES vendor_connectors(id),
  order_number TEXT UNIQUE NOT NULL,
  external_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready_for_review', 'approved', 'submitted', 'confirmed', 'partially_received', 'received', 'canceled', 'failed')),
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  expected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  square_variation_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('sale', 'return', 'receive', 'physical_count', 'waste', 'damage', 'correction', 'transfer')),
  quantity_delta NUMERIC,
  resulting_quantity NUMERIC,
  source TEXT NOT NULL,
  source_reference TEXT,
  reason TEXT,
  actor_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reconciliation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'review', 'resolved', 'canceled')),
  started_by TEXT,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  exception_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS command_center_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 6291456),
  purpose TEXT NOT NULL DEFAULT 'assistant',
  conversation_id TEXT,
  uploaded_by TEXT,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Raw, idempotent Square order facts plus item-level sales facts. Keeping the
-- original order JSON lets us repair analytics later without losing source data.
CREATE TABLE IF NOT EXISTS square_sales_orders (
  order_id TEXT PRIMARY KEY,
  location_id TEXT,
  state TEXT NOT NULL,
  source TEXT,
  total_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  refund_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  occurred_at TIMESTAMPTZ NOT NULL,
  business_date DATE NOT NULL,
  square_updated_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_order JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS square_sales_line_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES square_sales_orders(order_id) ON DELETE CASCADE,
  line_uid TEXT NOT NULL,
  location_id TEXT,
  square_variation_id TEXT,
  item_name TEXT NOT NULL,
  variation_name TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  returned_quantity NUMERIC NOT NULL DEFAULT 0,
  net_quantity NUMERIC NOT NULL DEFAULT 0,
  gross_sales_cents BIGINT NOT NULL DEFAULT 0,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  net_sales_cents BIGINT NOT NULL DEFAULT 0,
  returned_net_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  occurred_at TIMESTAMPTZ NOT NULL,
  business_date DATE NOT NULL,
  source TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, line_uid)
);

CREATE TABLE IF NOT EXISTS sales_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  range_start TIMESTAMPTZ NOT NULL,
  range_end TIMESTAMPTZ NOT NULL,
  started_by TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  orders_seen INTEGER NOT NULL DEFAULT 0,
  orders_stored INTEGER NOT NULL DEFAULT 0,
  lines_stored INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS inventory_daily_snapshots (
  id TEXT PRIMARY KEY,
  square_variation_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  quantity NUMERIC NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'square',
  UNIQUE (square_variation_id, location_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS vendor_connectors_vendor_idx ON vendor_connectors (vendor_id, status);
CREATE INDEX IF NOT EXISTS vendor_products_variation_idx ON vendor_products (square_variation_id, active);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON purchase_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_events_item_time_idx ON inventory_events (square_variation_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS reconciliation_sessions_status_idx ON reconciliation_sessions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS command_center_uploads_conversation_idx ON command_center_uploads (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS square_sales_orders_date_idx ON square_sales_orders (business_date DESC, location_id);
CREATE INDEX IF NOT EXISTS square_sales_line_items_date_idx ON square_sales_line_items (business_date DESC, square_variation_id);
CREATE INDEX IF NOT EXISTS square_sales_line_items_item_idx ON square_sales_line_items (square_variation_id, business_date DESC);
CREATE INDEX IF NOT EXISTS sales_sync_runs_status_idx ON sales_sync_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS inventory_daily_snapshots_item_date_idx ON inventory_daily_snapshots (square_variation_id, snapshot_date DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'midway-command-center',
  'midway-command-center',
  false,
  6291456,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv', 'text/tab-separated-values',
    'application/json', 'text/markdown',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO vendors (id, name, slug, status, ordering_method, notes)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Harbor Wholesale',
  'harbor-wholesale',
  'active',
  'portal',
  'Primary wholesale vendor. Add an MCP/API connection when vendor credentials are available.'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  updated_at = NOW();

-- 2026-07-22: allow saving vendor portal sign-ins (email + password) on connectors.
ALTER TABLE vendor_connectors DROP CONSTRAINT IF EXISTS vendor_connectors_auth_type_check;
ALTER TABLE vendor_connectors
  ADD CONSTRAINT vendor_connectors_auth_type_check
  CHECK (auth_type IN ('none', 'bearer', 'oauth', 'login'));

-- 2026-07-22: allow the OpenAI ('ai') provider kind on provider_connections.
ALTER TABLE provider_connections DROP CONSTRAINT IF EXISTS provider_connections_provider_kind_check;
ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_provider_kind_check
  CHECK (provider_kind IN ('payment', 'accounting', 'messaging', 'social', 'maps', 'ai'));
