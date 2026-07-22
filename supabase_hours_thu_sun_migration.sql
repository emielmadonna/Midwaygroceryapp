-- Canonical Midway store hours:
--   Sun/Mon 8 AM – 5 PM, Tue/Wed closed, Thu–Sat 8 AM – 7 PM.
INSERT INTO store_hours (day, open_time, close_time) VALUES
('monday',    '8:00 AM',  '5:00 PM' ),
('tuesday',   '',          ''        ),
('wednesday', '',          ''        ),
('thursday',  '8:00 AM',  '7:00 PM' ),
('friday',    '8:00 AM',  '7:00 PM' ),
('saturday',  '8:00 AM',  '7:00 PM' ),
('sunday',    '8:00 AM',  '5:00 PM' )
ON CONFLICT (day) DO UPDATE SET
  open_time  = EXCLUDED.open_time,
  close_time = EXCLUDED.close_time,
  updated_at = NOW();
