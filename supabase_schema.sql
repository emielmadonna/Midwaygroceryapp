-- Midway Gas & Grocery - Supabase Schema

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Fuel Prices Table
CREATE TABLE fuel_prices (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  type TEXT UNIQUE NOT NULL, -- 'unleaded', 'diesel'
  price DECIMAL(10,2) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Store Hours Table
CREATE TABLE store_hours (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  day TEXT UNIQUE NOT NULL, -- 'monday', 'tuesday', etc.
  -- Blank open/close values mean the store is closed; admin can edit and persist every day.
  open_time TEXT NOT NULL,
  close_time TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Fuel Inventory Table
CREATE TABLE fuel_inventory (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  type TEXT UNIQUE NOT NULL, -- 'unleaded', 'diesel'
  current_gallons INTEGER DEFAULT 0,
  capacity_gallons INTEGER DEFAULT 5000,
  alert_threshold INTEGER DEFAULT 1000,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Store Intelligence / AI Notes
CREATE TABLE store_intelligence (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  key TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Store Inventory (Cached from Square)
CREATE TABLE store_inventory (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  square_id TEXT UNIQUE NOT NULL,
  square_item_id TEXT NOT NULL,
  square_variation_id TEXT UNIQUE NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  category TEXT NOT NULL DEFAULT 'Store',
  active BOOLEAN NOT NULL DEFAULT true,
  hidden BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'square',
  price DECIMAL(10,2),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX store_inventory_visibility_idx
  ON store_inventory (active, hidden, category, name);

-- 6. RV Sites
CREATE TABLE rv_sites (
  id TEXT PRIMARY KEY,
  site_number TEXT UNIQUE NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  nightly_price_cents INTEGER NOT NULL DEFAULT 0,
  max_rv_length_feet INTEGER,
  map_x INTEGER,
  map_y INTEGER,
  map_width INTEGER,
  map_height INTEGER,
  rotation INTEGER DEFAULT 0,
  amp TEXT,
  site_type TEXT,
  shade TEXT,
  square_catalog_object_id TEXT,
  sku TEXT,
  sort_order INTEGER DEFAULT 0,
  short_description TEXT,
  customer_notes TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. RV Site Amenities
CREATE TABLE rv_site_amenities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rv_site_id TEXT NOT NULL REFERENCES rv_sites(id) ON DELETE CASCADE,
  amenity_key TEXT NOT NULL,
  amenity_label TEXT NOT NULL,
  amenity_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (rv_site_id, amenity_key)
);

-- 8. RV Bookings
CREATE TABLE rv_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code TEXT UNIQUE NOT NULL,
  rv_site_id TEXT NOT NULL REFERENCES rv_sites(id),
  rv_site_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  site_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  hold_id UUID,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  nights INTEGER NOT NULL,
  guests INTEGER DEFAULT 1,
  vehicles INTEGER DEFAULT 1,
  subtotal_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'hold' CHECK (status IN ('draft', 'hold', 'paid', 'confirmed', 'blocked', 'canceled', 'refunded', 'expired')),
  square_order_id TEXT,
  square_payment_id TEXT,
  square_refund_id TEXT,
  square_catalog_object_id TEXT,
  sku TEXT,
  checkout_url TEXT,
  expires_at TIMESTAMPTZ,
  driver_license_status TEXT NOT NULL DEFAULT 'not_uploaded' CHECK (driver_license_status IN ('not_uploaded', 'uploaded', 'verified', 'rejected', 'deleted')),
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT,
  refund_amount_cents INTEGER,
  refund_reason TEXT,
  refunded_at TIMESTAMPTZ,
  refunded_by TEXT,
  source TEXT NOT NULL DEFAULT 'website' CHECK (source IN ('website', 'admin', 'phone', 'ai')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date > start_date)
);

-- 9. RV Booking Holds
CREATE TABLE rv_booking_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rv_site_id TEXT NOT NULL REFERENCES rv_sites(id),
  rv_site_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  customer_session_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  converted_booking_id UUID REFERENCES rv_bookings(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'expired', 'released')),
  quote_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date > start_date)
);

-- 9b. Private Booking Documents
CREATE TABLE booking_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES rv_bookings(id) ON DELETE CASCADE,
  booking_code TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('driver_license')),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER,
  storage_bucket TEXT NOT NULL DEFAULT 'booking-documents',
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'verified', 'rejected', 'deleted')),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX rv_sites_status_sort_idx
  ON rv_sites (status, sort_order, site_number);

CREATE INDEX rv_bookings_availability_idx
  ON rv_bookings (rv_site_id, start_date, end_date)
  WHERE status IN ('hold', 'paid', 'confirmed', 'blocked');

CREATE INDEX rv_bookings_site_ids_gin_idx
  ON rv_bookings USING gin (rv_site_ids);

CREATE INDEX rv_bookings_square_order_idx
  ON rv_bookings (square_order_id)
  WHERE square_order_id IS NOT NULL;

CREATE INDEX rv_bookings_square_payment_idx
  ON rv_bookings (square_payment_id)
  WHERE square_payment_id IS NOT NULL;

CREATE INDEX rv_bookings_square_refund_idx
  ON rv_bookings (square_refund_id)
  WHERE square_refund_id IS NOT NULL;

CREATE INDEX rv_bookings_expiry_idx
  ON rv_bookings (status, expires_at)
  WHERE status = 'hold';

CREATE INDEX rv_booking_holds_active_availability_idx
  ON rv_booking_holds (rv_site_id, start_date, end_date, expires_at)
  WHERE status = 'active';

CREATE INDEX rv_booking_holds_site_ids_gin_idx
  ON rv_booking_holds USING gin (rv_site_ids);

CREATE INDEX rv_booking_holds_expiry_idx
  ON rv_booking_holds (status, expires_at);

CREATE INDEX rv_booking_holds_converted_booking_idx
  ON rv_booking_holds (converted_booking_id)
  WHERE converted_booking_id IS NOT NULL;

CREATE INDEX booking_documents_booking_idx ON booking_documents (booking_id, document_type, status);

CREATE INDEX booking_documents_retention_idx ON booking_documents (expires_at)
  WHERE expires_at IS NOT NULL AND status <> 'deleted';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'booking-documents',
  'booking-documents',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE rv_bookings
  ADD CONSTRAINT rv_bookings_hold_id_fkey
  FOREIGN KEY (hold_id) REFERENCES rv_booking_holds(id);

ALTER TABLE rv_bookings
  ADD CONSTRAINT rv_bookings_no_overlapping_blocking_stays
  EXCLUDE USING gist (
    rv_site_id WITH =,
    daterange(start_date, end_date, '[)') WITH &&
  )
  WHERE (status IN ('hold', 'paid', 'confirmed', 'blocked'));

ALTER TABLE rv_booking_holds
  ADD CONSTRAINT rv_booking_holds_no_overlapping_active_holds
  EXCLUDE USING gist (
    rv_site_id WITH =,
    daterange(start_date, end_date, '[)') WITH &&
  )
  WHERE (status = 'active');

-- 10. Square Webhook Events
CREATE TABLE square_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  square_event_id TEXT UNIQUE,
  event_type TEXT NOT NULL,
  booking_code TEXT,
  square_order_id TEXT,
  square_payment_id TEXT,
  raw_payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received', 'processed', 'failed', 'ignored')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX square_events_booking_code_idx
  ON square_events (booking_code)
  WHERE booking_code IS NOT NULL;

CREATE INDEX square_events_square_order_idx
  ON square_events (square_order_id)
  WHERE square_order_id IS NOT NULL;

-- 11. Admin Audit Log
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX admin_audit_log_created_idx
  ON admin_audit_log (created_at DESC);

CREATE INDEX admin_audit_log_target_idx
  ON admin_audit_log (target_type, target_id)
  WHERE target_type IS NOT NULL AND target_id IS NOT NULL;

-- 12. Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  booking_code TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX notifications_booking_code_idx
  ON notifications (booking_code)
  WHERE booking_code IS NOT NULL;

CREATE INDEX notifications_created_idx
  ON notifications (created_at DESC);

-- 13. Feature Flags
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  business_profile TEXT NOT NULL DEFAULT 'convenience_store_rv',
  default_theme TEXT NOT NULL DEFAULT 'midway_farmhouse',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE locations (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX locations_tenant_status_idx
  ON locations (tenant_id, status);

CREATE TABLE site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id TEXT,
  business_name TEXT NOT NULL,
  public_brand_name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  sms_phone TEXT,
  email TEXT,
  instagram_handle TEXT,
  instagram_url TEXT,
  instagram_posts JSONB NOT NULL DEFAULT '[]'::jsonb,
  google_maps_url TEXT,
  logo_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  public_site_url TEXT,
  theme_key TEXT NOT NULL DEFAULT 'midway_farmhouse',
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (tenant_id, location_id) REFERENCES locations(tenant_id, id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (tenant_id, location_id)
);

CREATE TABLE provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id TEXT,
  provider_key TEXT NOT NULL,
  provider_kind TEXT NOT NULL CHECK (provider_kind IN ('payment', 'accounting', 'messaging', 'social', 'maps', 'ai')),
  status TEXT NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected', 'connecting', 'connected', 'degraded', 'expired', 'revoked', 'error')),
  public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_ref TEXT,
  encrypted_credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_account_id TEXT,
  external_location_id TEXT,
  last_sync_at TIMESTAMPTZ,
  error_message TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (tenant_id, location_id) REFERENCES locations(tenant_id, id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (tenant_id, location_id, provider_key)
);

CREATE INDEX provider_connections_lookup_idx
  ON provider_connections (tenant_id, location_id, provider_key, status);

CREATE TABLE frontend_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id TEXT,
  theme_key TEXT NOT NULL,
  business_profile TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  draft_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (tenant_id, location_id) REFERENCES locations(tenant_id, id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (tenant_id, location_id)
);

CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key TEXT NOT NULL,
  flag_value JSONB NOT NULL DEFAULT 'false'::jsonb,
  scope TEXT NOT NULL DEFAULT 'tenant' CHECK (scope IN ('platform', 'tenant', 'location', 'role', 'environment')),
  tenant_id TEXT NOT NULL DEFAULT 'midway',
  location_id TEXT DEFAULT 'plain',
  role TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  rollout_state TEXT NOT NULL DEFAULT 'enabled' CHECK (rollout_state IN ('disabled', 'preview', 'enabled', 'locked')),
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (flag_key, scope, tenant_id, location_id, role)
);

CREATE INDEX feature_flags_lookup_idx
  ON feature_flags (flag_key, scope, tenant_id, location_id, role);

-- 14. Admin Users and Sessions
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'employee')),
  password_hash TEXT NOT NULL,
  disabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  session_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX admin_sessions_user_idx
  ON admin_sessions (admin_user_id, expires_at)
  WHERE revoked_at IS NULL;

-- Seed tenant/location config. Runtime business and provider values should come
-- from these tables, not process environment variables.
INSERT INTO tenants (id, name, status, business_profile, default_theme) VALUES
('midway', 'Midway Gas & Grocery', 'active', 'convenience_store_rv', 'midway_farmhouse')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  business_profile = EXCLUDED.business_profile,
  default_theme = EXCLUDED.default_theme,
  updated_at = NOW();

INSERT INTO locations (tenant_id, id, name, address, phone, timezone, status) VALUES
('midway', 'plain', 'Midway Gas & Grocery', '14193 Chiwawa Loop RD, Leavenworth, WA 98826', '(509) 596-1076', 'America/Los_Angeles', 'active')
ON CONFLICT (tenant_id, id) DO UPDATE SET
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  timezone = EXCLUDED.timezone,
  status = EXCLUDED.status,
  updated_at = NOW();

INSERT INTO site_settings (
  tenant_id, location_id, business_name, public_brand_name, address, phone,
  email, instagram_handle, instagram_url, instagram_posts, timezone,
  public_site_url, theme_key
) VALUES (
  'midway',
  'plain',
  'Midway Gas & Grocery',
  'Midway Gas & Grocery',
  '14193 Chiwawa Loop RD, Leavenworth, WA 98826',
  '(509) 596-1076',
  '',
  'midwayplain',
  'https://www.instagram.com/midwayplain/',
  '[]'::jsonb,
  'America/Los_Angeles',
  '',
  'midway_farmhouse'
)
ON CONFLICT (tenant_id, location_id) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  public_brand_name = EXCLUDED.public_brand_name,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  instagram_handle = EXCLUDED.instagram_handle,
  instagram_url = EXCLUDED.instagram_url,
  instagram_posts = EXCLUDED.instagram_posts,
  timezone = EXCLUDED.timezone,
  public_site_url = EXCLUDED.public_site_url,
  theme_key = EXCLUDED.theme_key,
  updated_at = NOW();

INSERT INTO frontend_configs (
  tenant_id, location_id, theme_key, business_profile, sections, published_config
) VALUES (
  'midway',
  'plain',
  'midway_farmhouse',
  'convenience_store_rv',
  '[
    {
      "key": "instagram",
      "enabled": true,
      "title": "Fresh from Midway.",
      "copy": "Store moments, seasonal notes, and RV site updates shown as a native gallery instead of a fragile social embed.",
      "items": [
        {
          "title": "Coffee, shelves, and the morning stop",
          "description": "Inside the store before the day heads toward Plain, Lake Wenatchee, and the pass.",
          "image": "/images/store-interior.jpg"
        },
        {
          "title": "Fuel before the valley roads",
          "description": "The storefront, pumps, and quick-stop basics at 14193 Chiwawa Loop RD.",
          "image": "/images/store-exterior.jpg"
        },
        {
          "title": "Room for the weekend rig",
          "description": "Full-hookup RV sites behind the store, close to coffee, ice, groceries, and firewood.",
          "image": "/images/exterior-wide.jpg"
        }
      ]
    }
  ]'::jsonb,
  '{}'::jsonb
)
ON CONFLICT (tenant_id, location_id) DO UPDATE SET
  theme_key = EXCLUDED.theme_key,
  business_profile = EXCLUDED.business_profile,
  sections = EXCLUDED.sections,
  published_config = EXCLUDED.published_config,
  updated_at = NOW();

INSERT INTO provider_connections (
  tenant_id, location_id, provider_key, provider_kind, status, public_config,
  encrypted_credentials, scopes
) VALUES
('midway', 'plain', 'square', 'payment', 'not_connected', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb),
('midway', 'plain', 'email', 'messaging', 'not_connected', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb),
('midway', 'plain', 'slack', 'messaging', 'not_connected', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb),
('midway', 'plain', 'instagram', 'social', 'connected', '{"handle":"midwayplain","profileUrl":"https://www.instagram.com/midwayplain/"}'::jsonb, '{}'::jsonb, '[]'::jsonb)
ON CONFLICT (tenant_id, location_id, provider_key) DO UPDATE SET
  provider_kind = EXCLUDED.provider_kind,
  status = EXCLUDED.status,
  public_config = EXCLUDED.public_config,
  encrypted_credentials = EXCLUDED.encrypted_credentials,
  scopes = EXCLUDED.scopes,
  updated_at = NOW();

-- Seed initial data. Fuel prices are intentionally not seeded; the public site
-- should collapse fuel UI until real prices are available.
INSERT INTO store_hours (day, open_time, close_time) VALUES
('monday', '8:00 AM', '5:00 PM'),
('tuesday', '', ''),
('wednesday', '', ''),
('thursday', '8:00 AM', '7:00 PM'),
('friday', '8:00 AM', '7:00 PM'),
('saturday', '8:00 AM', '7:00 PM'),
('sunday', '8:00 AM', '5:00 PM')
ON CONFLICT (day) DO UPDATE SET
  open_time = EXCLUDED.open_time,
  close_time = EXCLUDED.close_time,
  updated_at = NOW();

INSERT INTO rv_sites (
  id, site_number, display_name, status, nightly_price_cents,
  max_rv_length_feet, map_x, map_y, map_width, map_height, rotation,
  amp, site_type, shade, sku, sort_order, customer_notes, admin_notes
) VALUES
('rv-03', '03', 'Site 03', 'active', 4500, 40, 992, 244, 78, 34, -5, '50A', 'back', 'partial', 'MIDWAY-RV-03-50AMP', 1, 'Upper right-row full-hookup site close to the store approach.', 'Satellite trace places this as the first marked right-side pad; confirm final utility pedestal details.'),
('rv-04', '04', 'Site 04', 'active', 4500, 40, 992, 292, 78, 34, -5, '50A', 'back', 'partial', 'MIDWAY-RV-04-50AMP', 2, 'Right-row full-hookup site with partial shade near the upper drive.', 'Second marked right-side pad; verify driveway clearance against final survey.'),
('rv-05', '05', 'Site 05', 'active', 4500, 40, 992, 340, 78, 34, -5, '50A', 'back', 'sun', 'MIDWAY-RV-05-50AMP', 3, 'Angled right-row full-hookup site with an easy approach from the loop.', 'Marked pad is angled in the reference; keep rotation unless updated survey says otherwise.'),
('rv-06', '06', 'Site 06', 'active', 4500, 40, 992, 388, 78, 34, -5, '30A', 'back', 'sun', 'MIDWAY-RV-06-30AMP', 4, 'Angled right-row full-hookup site with sunny exposure.', 'Pairing location with site 5 appears tight; confirm vehicle length limit before publishing.'),
('rv-07', '07', 'Site 07', 'active', 4500, 40, 992, 456, 78, 34, -5, '30A', 'back', 'full', 'MIDWAY-RV-07-30AMP', 5, 'Quiet forest-edge back-in site with full shade.', 'First straight lower right-side pad in the reference image.'),
('rv-08', '08', 'Site 08', 'active', 4500, 40, 992, 508, 78, 34, -5, '30A', 'back', 'full', 'MIDWAY-RV-08-30AMP', 6, 'Full-shade right-row back-in site along the forest edge.', 'Lower right-side pad; good for shade preference once amenities are confirmed.'),
('rv-09', '09', 'Site 09', 'active', 4500, 40, 992, 560, 78, 34, -5, '30A', 'back', 'partial', 'MIDWAY-RV-09-30AMP', 7, 'Right-row back-in site with partial shade near the lower loop.', 'Reference marks this directly above site 10 on the right edge.'),
('rv-10', '10', 'Site 10', 'active', 4500, 40, 992, 612, 78, 34, -5, '30A', 'back', 'partial', 'MIDWAY-RV-10-30AMP', 8, 'Lower right-row end site with partial shade and a picnic table.', 'Right row runs 3-10; this is the bottom marked pad in the supplied reference.'),
('rv-11', '11', 'Site 11', 'active', 4000, 30, 206, 628, 78, 34, 5, '30A', 'back', 'partial', 'MIDWAY-RV-11-30AMP', 9, 'Lower left-row partial hookup site with water and electricity on the quieter side of the loop.', 'Left row runs 11-16 from lower to upper in the reference image.'),
('rv-12', '12', 'Site 12', 'active', 4000, 30, 206, 580, 78, 34, 5, '30A', 'back', 'partial', 'MIDWAY-RV-12-30AMP', 10, 'Left-row back-in site with partial shade near the lower loop.', 'Second lower-left marked pad; verify exact pedestal placement.'),
('rv-13', '13', 'Site 13', 'active', 4000, 30, 206, 532, 78, 34, 5, '30A', 'back', 'partial', 'MIDWAY-RV-13-30AMP', 11, 'Left-row family-size partial hookup site with water and electricity.', 'Confirm guest/vehicle limits before surfacing family-size upsell.'),
('rv-14', '14', 'Site 14', 'active', 4000, 30, 206, 484, 78, 34, 5, '50A', 'back', 'partial', 'MIDWAY-RV-14-50AMP', 12, 'Partial hookup 50 amp site on the left row with water and electricity.', 'Good default recommendation for 50 amp rigs; verify turning radius on the loop.'),
('rv-15', '15', 'Site 15', 'inactive', 4500, 40, 206, 436, 78, 34, 5, '50A', 'back', 'partial', 'MIDWAY-RV-15-50AMP', 13, 'Park mobile site; not available for guest booking.', 'Site 15 has the park mobile and should stay inactive for booking.'),
('rv-16', '16', 'Site 16', 'active', 4500, 40, 206, 388, 78, 34, 5, '50A', 'back', 'partial', 'MIDWAY-RV-16-50AMP', 14, 'Upper left-row premium end site closest to the store side.', 'Top marked left-side pad; confirm whether this should be held back for staff or owner use.'),
('tent-01', 'T01', 'Tent 01', 'active', 2000, 0, 506, 430, 48, 30, -2, 'Tent', 'tent', 'partial', 'MIDWAY-TENT-01', 15, 'Walk-in tent area on the center island with easy access to the store.', 'Center island tent inventory; confirm final site boundaries before peak-season launch.'),
('tent-02', 'T02', 'Tent 02', 'active', 2000, 0, 566, 420, 48, 30, 2, 'Tent', 'tent', 'partial', 'MIDWAY-TENT-02', 16, 'Walk-in tent area on the center island with easy access to the store.', 'Center island tent inventory; confirm final site boundaries before peak-season launch.'),
('tent-03', 'T03', 'Tent 03', 'active', 2000, 0, 626, 420, 48, 30, -2, 'Tent', 'tent', 'partial', 'MIDWAY-TENT-03', 17, 'Walk-in tent area on the center island with easy access to the store.', 'Center island tent inventory; confirm final site boundaries before peak-season launch.'),
('tent-04', 'T04', 'Tent 04', 'active', 2000, 0, 686, 432, 48, 30, 2, 'Tent', 'tent', 'partial', 'MIDWAY-TENT-04', 18, 'Walk-in tent area on the center island with easy access to the store.', 'Center island tent inventory; confirm final site boundaries before peak-season launch.'),
('tent-05', 'T05', 'Tent 05', 'active', 2000, 0, 486, 484, 48, 30, 2, 'Tent', 'tent', 'partial', 'MIDWAY-TENT-05', 19, 'Walk-in tent area on the center island with easy access to the store.', 'Center island tent inventory; confirm final site boundaries before peak-season launch.'),
('tent-06', 'T06', 'Tent 06', 'active', 2000, 0, 546, 498, 48, 30, -2, 'Tent', 'tent', 'partial', 'MIDWAY-TENT-06', 20, 'Walk-in tent area on the center island with easy access to the store.', 'Center island tent inventory; confirm final site boundaries before peak-season launch.'),
('tent-07', 'T07', 'Tent 07', 'active', 2000, 0, 606, 504, 48, 30, 2, 'Tent', 'tent', 'partial', 'MIDWAY-TENT-07', 21, 'Walk-in tent area on the center island with easy access to the store.', 'Center island tent inventory; confirm final site boundaries before peak-season launch.'),
('tent-08', 'T08', 'Tent 08', 'active', 2000, 0, 666, 498, 48, 30, -2, 'Tent', 'tent', 'partial', 'MIDWAY-TENT-08', 22, 'Walk-in tent area on the center island with easy access to the store.', 'Center island tent inventory; confirm final site boundaries before peak-season launch.'),
('tent-09', 'T09', 'Tent 09', 'active', 2000, 0, 526, 556, 48, 30, -2, 'Tent', 'tent', 'partial', 'MIDWAY-TENT-09', 23, 'Walk-in tent area on the center island with easy access to the store.', 'Center island tent inventory; confirm final site boundaries before peak-season launch.'),
('tent-10', 'T10', 'Tent 10', 'active', 2000, 0, 626, 562, 48, 30, 2, 'Tent', 'tent', 'partial', 'MIDWAY-TENT-10', 24, 'Walk-in tent area on the center island with easy access to the store.', 'Center island tent inventory; confirm final site boundaries before peak-season launch.')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  nightly_price_cents = EXCLUDED.nightly_price_cents,
  max_rv_length_feet = EXCLUDED.max_rv_length_feet,
  map_x = EXCLUDED.map_x,
  map_y = EXCLUDED.map_y,
  map_width = EXCLUDED.map_width,
  map_height = EXCLUDED.map_height,
  rotation = EXCLUDED.rotation,
  amp = EXCLUDED.amp,
  site_type = EXCLUDED.site_type,
  shade = EXCLUDED.shade,
  sku = EXCLUDED.sku,
  sort_order = EXCLUDED.sort_order,
  customer_notes = EXCLUDED.customer_notes,
  admin_notes = EXCLUDED.admin_notes,
  updated_at = NOW();

DELETE FROM rv_site_amenities
WHERE rv_site_id IN (
  'rv-03', 'rv-04', 'rv-05', 'rv-06', 'rv-07', 'rv-08', 'rv-09', 'rv-10',
  'rv-11', 'rv-12', 'rv-13', 'rv-14', 'rv-15', 'rv-16',
  'tent-01', 'tent-02', 'tent-03', 'tent-04', 'tent-05',
  'tent-06', 'tent-07', 'tent-08', 'tent-09', 'tent-10'
);

INSERT INTO rv_site_amenities (rv_site_id, amenity_key, amenity_label) VALUES
('rv-03', 'full_hookup', 'Full hookup'), ('rv-03', 'water', 'Water'), ('rv-03', 'septic', 'Septic'), ('rv-03', 'big_rig', 'Big rig'), ('rv-03', 'walk_to_store', 'Walk to store'),
('rv-04', 'full_hookup', 'Full hookup'), ('rv-04', 'water', 'Water'), ('rv-04', 'septic', 'Septic'), ('rv-04', 'big_rig', 'Big rig'),
('rv-05', 'full_hookup', 'Full hookup'), ('rv-05', 'water', 'Water'), ('rv-05', 'septic', 'Septic'), ('rv-05', 'easy_entry', 'Easy entry'),
('rv-06', 'full_hookup', 'Full hookup'), ('rv-06', 'water', 'Water'), ('rv-06', 'septic', 'Septic'), ('rv-06', 'pet_friendly', 'Pet-friendly'),
('rv-07', 'full_hookup', 'Full hookup'), ('rv-07', 'water', 'Water'), ('rv-07', 'septic', 'Septic'), ('rv-07', 'forest_edge', 'Forest edge'), ('rv-07', 'quiet', 'Quiet'),
('rv-08', 'full_hookup', 'Full hookup'), ('rv-08', 'water', 'Water'), ('rv-08', 'septic', 'Septic'), ('rv-08', 'forest_edge', 'Forest edge'), ('rv-08', 'deep_shade', 'Deep shade'),
('rv-09', 'full_hookup', 'Full hookup'), ('rv-09', 'water', 'Water'), ('rv-09', 'septic', 'Septic'), ('rv-09', 'forest_edge', 'Forest edge'), ('rv-09', 'pet_friendly', 'Pet-friendly'),
('rv-10', 'full_hookup', 'Full hookup'), ('rv-10', 'water', 'Water'), ('rv-10', 'septic', 'Septic'), ('rv-10', 'end_site', 'End site'), ('rv-10', 'picnic_table', 'Picnic table'),
('rv-11', 'partial_hookup', 'Partial hookup'), ('rv-11', 'water', 'Water'), ('rv-11', 'electricity', 'Electricity'), ('rv-11', 'quiet_side', 'Quiet side'), ('rv-11', 'forest_edge', 'Forest edge'),
('rv-12', 'partial_hookup', 'Partial hookup'), ('rv-12', 'water', 'Water'), ('rv-12', 'electricity', 'Electricity'), ('rv-12', 'pet_friendly', 'Pet-friendly'), ('rv-12', 'forest_edge', 'Forest edge'),
('rv-13', 'partial_hookup', 'Partial hookup'), ('rv-13', 'water', 'Water'), ('rv-13', 'electricity', 'Electricity'), ('rv-13', 'family_size', 'Family-size'),
('rv-14', 'partial_hookup', 'Partial hookup'), ('rv-14', 'water', 'Water'), ('rv-14', 'electricity', 'Electricity'), ('rv-14', 'premium', 'Premium'), ('rv-14', 'big_rig', 'Big rig'),
('rv-15', 'full_hookup', 'Full hookup'), ('rv-15', 'water', 'Water'), ('rv-15', 'septic', 'Septic'), ('rv-15', 'premium', 'Premium'), ('rv-15', 'road_edge', 'Road edge'),
('rv-16', 'full_hookup', 'Full hookup'), ('rv-16', 'water', 'Water'), ('rv-16', 'septic', 'Septic'), ('rv-16', 'premium', 'Premium'), ('rv-16', 'end_site', 'End site'), ('rv-16', 'walk_to_store', 'Walk to store'),
('tent-01', 'tent_area', 'Tent area'), ('tent-01', 'walk_in', 'Walk-in'), ('tent-01', 'picnic_table', 'Picnic table'), ('tent-01', 'walk_to_store', 'Walk to store'),
('tent-02', 'tent_area', 'Tent area'), ('tent-02', 'walk_in', 'Walk-in'), ('tent-02', 'picnic_table', 'Picnic table'), ('tent-02', 'walk_to_store', 'Walk to store'),
('tent-03', 'tent_area', 'Tent area'), ('tent-03', 'walk_in', 'Walk-in'), ('tent-03', 'picnic_table', 'Picnic table'), ('tent-03', 'walk_to_store', 'Walk to store'),
('tent-04', 'tent_area', 'Tent area'), ('tent-04', 'walk_in', 'Walk-in'), ('tent-04', 'picnic_table', 'Picnic table'), ('tent-04', 'walk_to_store', 'Walk to store'),
('tent-05', 'tent_area', 'Tent area'), ('tent-05', 'walk_in', 'Walk-in'), ('tent-05', 'picnic_table', 'Picnic table'), ('tent-05', 'walk_to_store', 'Walk to store'),
('tent-06', 'tent_area', 'Tent area'), ('tent-06', 'walk_in', 'Walk-in'), ('tent-06', 'picnic_table', 'Picnic table'), ('tent-06', 'walk_to_store', 'Walk to store'),
('tent-07', 'tent_area', 'Tent area'), ('tent-07', 'walk_in', 'Walk-in'), ('tent-07', 'picnic_table', 'Picnic table'), ('tent-07', 'walk_to_store', 'Walk to store'),
('tent-08', 'tent_area', 'Tent area'), ('tent-08', 'walk_in', 'Walk-in'), ('tent-08', 'picnic_table', 'Picnic table'), ('tent-08', 'walk_to_store', 'Walk to store'),
('tent-09', 'tent_area', 'Tent area'), ('tent-09', 'walk_in', 'Walk-in'), ('tent-09', 'picnic_table', 'Picnic table'), ('tent-09', 'walk_to_store', 'Walk to store'),
('tent-10', 'tent_area', 'Tent area'), ('tent-10', 'walk_in', 'Walk-in'), ('tent-10', 'picnic_table', 'Picnic table'), ('tent-10', 'walk_to_store', 'Walk to store')
ON CONFLICT (rv_site_id, amenity_key) DO UPDATE SET
  amenity_label = EXCLUDED.amenity_label;

INSERT INTO rv_bookings (
  booking_code, rv_site_id, customer_name, customer_phone, start_date, end_date,
  nights, guests, vehicles, subtotal_cents, tax_cents, fee_cents, total_cents,
  currency, status, source
) VALUES
('BLOCK-RV07-JUN20', 'rv-07', 'Owner Hold', '', '2026-06-20', '2026-06-21', 1, 1, 1, 0, 0, 0, 0, 'USD', 'blocked', 'admin'),
('BLOCK-RV08-JUN20', 'rv-08', 'Owner Hold', '', '2026-06-20', '2026-06-21', 1, 1, 1, 0, 0, 0, 0, 'USD', 'blocked', 'admin')
ON CONFLICT (booking_code) DO UPDATE SET
  rv_site_id = EXCLUDED.rv_site_id,
  customer_name = EXCLUDED.customer_name,
  customer_phone = EXCLUDED.customer_phone,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  nights = EXCLUDED.nights,
  guests = EXCLUDED.guests,
  vehicles = EXCLUDED.vehicles,
  subtotal_cents = EXCLUDED.subtotal_cents,
  tax_cents = EXCLUDED.tax_cents,
  fee_cents = EXCLUDED.fee_cents,
  total_cents = EXCLUDED.total_cents,
  currency = EXCLUDED.currency,
  status = EXCLUDED.status,
  source = EXCLUDED.source,
  updated_at = NOW();
