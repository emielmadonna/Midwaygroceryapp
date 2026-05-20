ALTER TABLE rv_bookings
  ADD COLUMN IF NOT EXISTS rv_site_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS site_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS driver_license_status TEXT NOT NULL DEFAULT 'not_uploaded';

ALTER TABLE rv_bookings
  DROP CONSTRAINT IF EXISTS rv_bookings_driver_license_status_check;

ALTER TABLE rv_bookings
  ADD CONSTRAINT rv_bookings_driver_license_status_check
  CHECK (driver_license_status IN ('not_uploaded', 'uploaded', 'verified', 'rejected', 'deleted'));

UPDATE rv_bookings
SET rv_site_ids = to_jsonb(ARRAY[rv_site_id])
WHERE rv_site_ids = '[]'::jsonb;

ALTER TABLE rv_booking_holds
  ADD COLUMN IF NOT EXISTS rv_site_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quote_snapshot JSONB;

UPDATE rv_booking_holds
SET rv_site_ids = to_jsonb(ARRAY[rv_site_id])
WHERE rv_site_ids = '[]'::jsonb;

CREATE TABLE IF NOT EXISTS booking_documents (
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

CREATE INDEX IF NOT EXISTS rv_bookings_site_ids_gin_idx
  ON rv_bookings USING gin (rv_site_ids);

CREATE INDEX IF NOT EXISTS rv_booking_holds_site_ids_gin_idx
  ON rv_booking_holds USING gin (rv_site_ids);

CREATE INDEX IF NOT EXISTS booking_documents_booking_idx
  ON booking_documents (booking_id, document_type, status);

CREATE INDEX IF NOT EXISTS booking_documents_retention_idx
  ON booking_documents (expires_at)
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
