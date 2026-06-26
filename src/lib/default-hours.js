// ─────────────────────────────────────────────────────────────────────────
// Canonical Midway store hours — the SINGLE SOURCE OF TRUTH for the schedule.
//
// At runtime the live site reads hours from the Supabase `store_hours` table,
// which overrides this. These values are the fallback used when the DB load is
// empty/partial/unavailable, and the seed the migrations write. Every code path
// (frontend `src/midway.jsx`, server `src/lib/midway-harness.js`) imports from
// here so the fallbacks can never drift apart again.
//
// Closed days use `{ day, closed: true }`. Keep the SQL seed migrations
// (supabase_contact_hours_migration.sql, supabase_hours_thu_sun_migration.sql)
// in sync with this list.
// ─────────────────────────────────────────────────────────────────────────

export const DEFAULT_STORE_HOURS = Object.freeze([
  Object.freeze({ day: 'sunday', open: '8:00 AM', close: '5:00 PM' }),
  Object.freeze({ day: 'monday', open: '8:00 AM', close: '5:00 PM' }),
  Object.freeze({ day: 'tuesday', closed: true }),
  Object.freeze({ day: 'wednesday', closed: true }),
  Object.freeze({ day: 'thursday', open: '7:00 AM', close: '7:00 PM' }),
  Object.freeze({ day: 'friday', open: '7:00 AM', close: '7:00 PM' }),
  Object.freeze({ day: 'saturday', open: '7:00 AM', close: '7:00 PM' }),
]);

// Plain (deep-cloned) copy for callers that need a mutable array.
export function defaultStoreHours() {
  return DEFAULT_STORE_HOURS.map(row => ({ ...row }));
}
