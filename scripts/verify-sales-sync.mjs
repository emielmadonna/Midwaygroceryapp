#!/usr/bin/env node
// Verifies Square sales sync accuracy: compares what the daily cron stored in
// Supabase (square_sales_orders) against a fresh, independent pull from the
// Square Orders API over the same window. Read-only on both sides.
//
// Usage: node scripts/verify-sales-sync.mjs [days]
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { normalizeSquareOrders } from '../src/lib/sales-analytics.js';
import { searchSquareOrders } from '../src/lib/square-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true, quiet: true });

const days = Math.max(1, Math.min(60, Number(process.argv[2]) || 7));
const timezone = 'America/Los_Angeles';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const locationId = process.env.SQUARE_LOCATION_ID;

const endAt = new Date();
const startAt = new Date(endAt.getTime() - days * 24 * 60 * 60 * 1000);

const squareOrders = await searchSquareOrders({
  locationIds: [locationId],
  startAt: startAt.toISOString(),
  endAt: endAt.toISOString(),
  env: {
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT || 'production',
  },
});
const fresh = normalizeSquareOrders(squareOrders, { timezone });

const { data: storedRows, error } = await supabase
  .from('square_sales_orders')
  .select('order_id,business_date,total_cents,refund_cents')
  .gte('occurred_at', startAt.toISOString())
  .lte('occurred_at', endAt.toISOString());
if (error) throw error;

const byDay = new Map();
const bucket = date => {
  if (!byDay.has(date)) byDay.set(date, { date, storedCount: 0, storedCents: 0, freshCount: 0, freshCents: 0 });
  return byDay.get(date);
};
for (const row of storedRows) {
  const day = bucket(row.business_date);
  day.storedCount += 1;
  day.storedCents += Number(row.total_cents) - Number(row.refund_cents || 0);
}
for (const order of fresh.orders) {
  const day = bucket(order.businessDate);
  day.freshCount += 1;
  day.freshCents += order.totalCents - (order.refundCents || 0);
}

const storedIds = new Set(storedRows.map(row => row.order_id));
const missingFromDb = fresh.orders.filter(order => !storedIds.has(order.orderId));

const money = cents => `$${(cents / 100).toFixed(2)}`;
console.log(`Window: last ${days} days · location ${locationId} · timezone ${timezone}\n`);
console.log('date        | stored #  stored $   | square #  square $   | match');
let mismatches = 0;
for (const day of [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))) {
  const match = day.storedCount === day.freshCount && day.storedCents === day.freshCents;
  if (!match) mismatches += 1;
  console.log(`${day.date}  | ${String(day.storedCount).padStart(7)}  ${money(day.storedCents).padStart(10)} | ${String(day.freshCount).padStart(7)}  ${money(day.freshCents).padStart(10)} | ${match ? 'OK' : 'MISMATCH'}`);
}
console.log(`\nOrders in Square but not in database: ${missingFromDb.length}`);
for (const order of missingFromDb.slice(0, 10)) {
  console.log(`  - ${order.orderId} (${order.businessDate}, ${money(order.totalCents)})`);
}
console.log(mismatches === 0 && missingFromDb.length === 0
  ? '\nRESULT: PASS — the database matches Square exactly for this window.'
  : `\nRESULT: ${mismatches} day(s) mismatched. Note: today/most-recent day can differ until the next 9:30am sync runs.`);
