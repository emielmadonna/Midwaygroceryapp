// Read-only restock analysis: pulls Square catalog + on-hand inventory + 60-day
// sales velocity, then flags low-stock items that are actually selling.
// No writes to Square. Output: JSON to stdout + a human summary to stderr.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { squareRequest } from '../src/lib/square-api.js';

// Load .env.local on top of .env (dotenv/config only read .env)
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    // .env.local holds the real creds and must override placeholder values from .env
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const env = {
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.SQUARE_ENVIRONMENT || 'production',
  apiVersion: process.env.SQUARE_VERSION,
};
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const DAYS = Number(process.env.RESTOCK_DAYS || 60);       // context window for totals
const RECENT_DAYS = Number(process.env.RESTOCK_RECENT_DAYS || 28); // window that drives velocity (seasonal)
const LOW_STOCK_THRESHOLD = Number(process.env.RESTOCK_LOW_THRESHOLD || 6);
const COVER_WEEKS = Number(process.env.RESTOCK_COVER_WEEKS || 1.5); // lean: ~1 week + buffer, we order weekly
// Prepared/service items that are NOT wholesale reorders (scooped from bulk, campground bookings, misc)
// In-house/prepared/service items that are NOT Harbor wholesale reorders. The
// "Ice Cream - *" namespace is the in-store POS serving buttons (scoops/cones/
// cups/shakes); wholesale pints are branded instead (e.g. "Tillamook IC ...").
const EXCLUDE_RE = /^ice cream - |hookup night|camping night|^other |campsite|night$|coffee - (drip|latte|americano|mocha|cappuccino)|\bfee\b|extra vehicle/i;
const isReorderable = (v) => !EXCLUDE_RE.test(v.name) && !String(v.sku).toUpperCase().startsWith('MIDWAY-');

if (!env.accessToken || !LOCATION_ID) {
  console.error('Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID'); process.exit(1);
}

const sinceISO = new Date(Date.now() - DAYS * 864e5).toISOString();

// 1) Catalog: all ITEM objects + their variations
async function listCatalog() {
  const items = [];
  let cursor;
  do {
    const qs = new URLSearchParams({ types: 'ITEM' });
    if (cursor) qs.set('cursor', cursor);
    const res = await squareRequest(`/v2/catalog/list?${qs}`, { env });
    items.push(...(res.objects ?? []));
    cursor = res.cursor;
  } while (cursor);
  return items;
}

// 2) On-hand inventory counts for a set of variation IDs
async function inventoryCounts(variationIds) {
  const counts = new Map();
  for (let i = 0; i < variationIds.length; i += 500) {
    const chunk = variationIds.slice(i, i + 500);
    let cursor;
    do {
      const res = await squareRequest('/v2/inventory/counts/batch-retrieve', {
        method: 'POST', env,
        body: { catalog_object_ids: chunk, location_ids: [LOCATION_ID], cursor },
      });
      for (const c of res.counts ?? []) {
        if (c.state === 'IN_STOCK') {
          counts.set(c.catalog_object_id, Number(c.quantity ?? 0));
        }
      }
      cursor = res.cursor;
    } while (cursor);
  }
  return counts;
}

// 3) Units sold per variation, bucketed into the full window (totals) and a
// recent window (drives velocity, so a seasonal ramp isn't diluted by old weeks).
async function salesByVariation() {
  const recentCutoff = Date.now() - RECENT_DAYS * 864e5;
  const sold = new Map();        // full window (DAYS) totals
  const soldRecent = new Map();  // recent window (RECENT_DAYS)
  let cursor;
  do {
    const res = await squareRequest('/v2/orders/search', {
      method: 'POST', env,
      body: {
        location_ids: [LOCATION_ID],
        cursor,
        query: {
          filter: {
            date_time_filter: { created_at: { start_at: sinceISO } },
            state_filter: { states: ['COMPLETED', 'OPEN'] },
          },
          sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
        },
        limit: 500,
      },
    });
    for (const order of res.orders ?? []) {
      const isRecent = new Date(order.created_at ?? 0).getTime() >= recentCutoff;
      for (const li of order.line_items ?? []) {
        const id = li.catalog_object_id;
        if (!id) continue;
        const qty = Number(li.quantity ?? 0);
        sold.set(id, (sold.get(id) ?? 0) + qty);
        if (isRecent) soldRecent.set(id, (soldRecent.get(id) ?? 0) + qty);
      }
    }
    cursor = res.cursor;
  } while (cursor);
  return { sold, soldRecent };
}

console.error(`Pulling Square (env=${env.environment}, location=${LOCATION_ID}, window=${DAYS}d)...`);
const [catalog, sales] = await Promise.all([listCatalog(), salesByVariation()]);
const { sold, soldRecent } = sales;

// flatten variations
const variations = [];
for (const obj of catalog) {
  const itemData = obj.item_data ?? obj.itemData ?? {};
  for (const v of itemData.variations ?? []) {
    const vd = v.item_variation_data ?? v.itemVariationData ?? {};
    const pm = vd.price_money ?? vd.priceMoney ?? {};
    variations.push({
      variationId: v.id,
      name: [itemData.name, vd.name].filter(Boolean).join(' - '),
      sku: vd.sku ?? '',
      category: itemData.categories?.[0]?.name ?? itemData.category_id ?? 'Store',
      priceCents: Number(pm.amount ?? 0),
      trackInventory: vd.track_inventory ?? vd.location_overrides?.some(o => o.track_inventory) ?? false,
    });
  }
}

const onHand = await inventoryCounts(variations.map(v => v.variationId));

const rows = variations.map(v => {
  const qty = onHand.has(v.variationId) ? onHand.get(v.variationId) : null;
  const units = sold.get(v.variationId) ?? 0;
  const unitsRecent = soldRecent.get(v.variationId) ?? 0;
  // Velocity is driven by the RECENT window so a summer ramp isn't diluted by
  // slow spring weeks. Fall back to the full-window rate if there were no recent
  // sales but the item clearly sold over the longer window.
  const velWkRecent = unitsRecent / (RECENT_DAYS / 7);
  const velWkFull = units / (DAYS / 7);
  const velWk = velWkRecent > 0 ? velWkRecent : velWkFull;
  // Square on-hand is unreliable here (negatives/nulls everywhere), so only
  // trust it to REDUCE an order when it's a real positive count.
  const trustedOnHand = qty != null && qty > 0 ? qty : 0;
  const target = Math.ceil(velWk * COVER_WEEKS);
  const suggestedOrderUnits = Math.max(0, target - trustedOnHand);
  return {
    name: v.name, sku: v.sku, category: v.category,
    onHand: qty,
    sold60d: units,
    soldRecent: unitsRecent,
    retailPrice: +(v.priceCents / 100).toFixed(2),
    revenue60d: +(units * v.priceCents / 100).toFixed(2),
    velocityPerWeek: +velWk.toFixed(1),
    weeksOfCover: velWk > 0 && qty != null && qty > 0 ? +(qty / velWk).toFixed(1) : null,
    suggestedOrderUnits,
    reorderable: isReorderable(v),
  };
});

// Restock candidates: VELOCITY-DRIVEN — reorderable, currently selling, and not
// already sitting on enough trusted stock to cover the week. No longer gated on
// the (unmaintained) Square on-hand number.
const candidates = rows
  .filter(r => r.reorderable && r.velocityPerWeek > 0 && r.suggestedOrderUnits > 0)
  .sort((a, b) => b.velocityPerWeek - a.velocityPerWeek || b.sold60d - a.sold60d);

// Top sellers (reorderable + prepared), ranked by revenue and by units
const topByRevenue = [...rows].filter(r => r.revenue60d > 0).sort((a, b) => b.revenue60d - a.revenue60d);
const topByUnits = [...rows].filter(r => r.sold60d > 0).sort((a, b) => b.sold60d - a.sold60d);

console.error(`\nVariations: ${variations.length} | with sales(${DAYS}d): ${rows.filter(r => r.sold60d > 0).length} | selling now(${RECENT_DAYS}d): ${rows.filter(r => r.soldRecent > 0).length} | restock candidates: ${candidates.length}\n`);
console.error('TOP RESTOCK CANDIDATES (velocity-driven, recent ' + RECENT_DAYS + 'd):');
console.error('onHand  sold/' + DAYS + 'd  rec/' + RECENT_DAYS + 'd  vel/wk  order  SKU            name');
for (const r of candidates.slice(0, 40)) {
  console.error(
    String(r.onHand ?? '—').padStart(5),
    String(r.sold60d).padStart(8),
    String(r.soldRecent).padStart(7),
    String(r.velocityPerWeek).padStart(7),
    String(r.suggestedOrderUnits).padStart(6),
    '  ' + (r.sku || '—').padEnd(14),
    r.name,
  );
}

const totalRevenue = topByRevenue.reduce((s, r) => s + r.revenue60d, 0);
process.stdout.write(JSON.stringify({
  generatedAt: new Date().toISOString(), windowDays: DAYS, recentDays: RECENT_DAYS,
  lowStockThreshold: LOW_STOCK_THRESHOLD, coverWeeks: COVER_WEEKS, location: LOCATION_ID,
  totalRevenue: +totalRevenue.toFixed(2), candidates, topByRevenue, topByUnits, all: rows,
}, null, 2));
