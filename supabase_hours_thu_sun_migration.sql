-- Set store hours to Thu–Sun 7 AM – 7 PM. Mon–Wed closed.
INSERT INTO store_hours (day, open_time, close_time) VALUES
('monday',    '',          ''        ),
('tuesday',   '',          ''        ),
('wednesday', '',          ''        ),
('thursday',  '7:00 AM',  '7:00 PM' ),
('friday',    '7:00 AM',  '7:00 PM' ),
('saturday',  '7:00 AM',  '7:00 PM' ),
('sunday',    '7:00 AM',  '7:00 PM' )
ON CONFLICT (day) DO UPDATE SET
  open_time  = EXCLUDED.open_time,
  close_time = EXCLUDED.close_time,
  updated_at = NOW();
