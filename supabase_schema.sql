-- Midway Gas & Grocery - Supabase Schema

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
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2),
  emoji TEXT DEFAULT '🛒',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial data
INSERT INTO fuel_prices (type, price) VALUES ('unleaded', 3.89), ('diesel', 4.39);
INSERT INTO store_hours (day, open_time, close_time) VALUES 
('monday', '6:00 AM', '9:00 PM'),
('tuesday', '6:00 AM', '9:00 PM'),
('wednesday', '6:00 AM', '9:00 PM'),
('thursday', '6:00 AM', '9:00 PM'),
('friday', '6:00 AM', '9:00 PM'),
('saturday', '7:00 AM', '9:00 PM'),
('sunday', '8:00 AM', '8:00 PM');
