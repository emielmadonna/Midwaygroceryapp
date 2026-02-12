import { createClient } from '@supabase/supabase-js';

// These should be added to your .env file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create a safe client that won't crash the app if keys are missing
export const supabase = (supabaseUrl && supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseAnonKey)
    : {
        from: () => ({
            select: () => ({ single: () => Promise.resolve({ data: null, error: null }), eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }), then: () => Promise.resolve({ data: [], error: null }) }),
            upsert: () => ({ then: () => Promise.resolve({ error: null }) })
        })
    };

/**
 * DATABASE SCHEMA REFERENCE (SQL):
 * 
 * -- Fuel Prices Table
 * CREATE TABLE fuel_prices (
 *   id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 *   type TEXT UNIQUE NOT NULL, -- 'unleaded', 'diesel'
 *   price DECIMAL(10,2) NOT NULL,
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * 
 * -- Store Hours Table
 * CREATE TABLE store_hours (
 *   id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 *   day TEXT UNIQUE NOT NULL, -- 'monday', 'tuesday', etc.
 *   open_time TEXT NOT NULL,
 *   close_time TEXT NOT NULL,
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * 
 * -- Fuel Inventory Table
 * CREATE TABLE fuel_inventory (
 *   id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 *   type TEXT UNIQUE NOT NULL, -- 'unleaded', 'diesel'
 *   current_gallons INTEGER DEFAULT 0,
 *   capacity_gallons INTEGER DEFAULT 5000,
 *   alert_threshold INTEGER DEFAULT 1000,
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 */

export async function fetchFuelPrices() {
    const { data, error } = await supabase
        .from('fuel_prices')
        .select('*');
    if (error) throw error;
    return data;
}

export async function updateFuelPrice(type, price) {
    const { error } = await supabase
        .from('fuel_prices')
        .upsert({ type, price, updated_at: new Date() }, { onConflict: 'type' });
    if (error) throw error;
}

export async function fetchStoreHours() {
    const { data, error } = await supabase
        .from('store_hours')
        .select('*');
    if (error) throw error;
    return data;
}

export async function updateStoreHours(day, open_time, close_time) {
    const { error } = await supabase
        .from('store_hours')
        .upsert({ day, open_time, close_time, updated_at: new Date() }, { onConflict: 'day' });
    if (error) throw error;
}
