-- Update launch-critical Midway contact details and store hours.
-- Closed days are represented by blank open/close values; the admin dashboard
-- can edit these rows later through PATCH /api/admin/hours.

UPDATE locations
SET
  phone = '(509) 596-1076',
  updated_at = NOW()
WHERE tenant_id = 'midway'
  AND id = 'plain';

UPDATE site_settings
SET
  phone = '(509) 596-1076',
  updated_at = NOW()
WHERE tenant_id = 'midway'
  AND location_id = 'plain';

INSERT INTO store_hours (day, open_time, close_time) VALUES
('monday', '8:00 AM', '5:00 PM'),
('tuesday', '', ''),
('wednesday', '', ''),
('thursday', '7:00 AM', '7:00 PM'),
('friday', '7:00 AM', '7:00 PM'),
('saturday', '7:00 AM', '7:00 PM'),
('sunday', '8:00 AM', '5:00 PM')
ON CONFLICT (day) DO UPDATE SET
  open_time = EXCLUDED.open_time,
  close_time = EXCLUDED.close_time,
  updated_at = NOW();
