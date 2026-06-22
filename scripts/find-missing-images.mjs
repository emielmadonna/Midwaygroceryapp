// Lists Square catalog items that still need a product photo, for the Harbor backfill.
// Output: /tmp/midway-missing.json = [{ id, sku, name }]
// Criteria: no Square image, numeric SKU (Harbor ItemID shape), not a booking SKU,
// and not already attempted (scripts/.harbor-tried.json).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const TOKEN = (readFileSync('.env.local', 'utf8').match(/^SQUARE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!TOKEN) { console.error('Missing SQUARE_ACCESS_TOKEN'); process.exit(1); }
const TRIED_PATH = 'scripts/.harbor-tried.json';
const tried = new Set(existsSync(TRIED_PATH) ? JSON.parse(readFileSync(TRIED_PATH, 'utf8')) : []);

async function sqGet(path) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(`https://connect.squareup.com${path}`, {
        headers: { Authorization: `Bearer ${TOKEN}`, 'Square-Version': '2026-01-22' },
      });
      if (!r.ok) throw new Error(`Square ${r.status}`);
      return await r.json();
    } catch (e) { if (t === 3) throw e; await new Promise(s => setTimeout(s, 1000)); }
  }
}

const items = [];
let cursor;
do {
  const d = await sqGet(`/v2/catalog/list?types=ITEM${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  items.push(...(d.objects || []).filter(o => o.type === 'ITEM'));
  cursor = d.cursor;
} while (cursor);

const missing = [];
for (const o of items) {
  const it = o.item_data || {};
  if (it.image_ids?.length) continue;
  let sku = null;
  for (const v of it.variations || []) { const s = (v.item_variation_data || {}).sku; if (s) { sku = s; break; } }
  if (!sku || !/^\d+$/.test(sku)) continue;          // numeric SKUs only (Harbor ItemID shape)
  if (sku.toUpperCase().startsWith('MIDWAY-')) continue;
  if (tried.has(sku)) continue;                       // already attempted in a prior run
  missing.push({ id: o.id, sku, name: (it.name || '').slice(0, 50) });
}

writeFileSync('/tmp/midway-missing.json', JSON.stringify(missing));
console.log(`${missing.length} item(s) need photos (of ${items.length} catalog items; ${tried.size} already attempted).`);
if (missing.length) console.log('sample:', missing.slice(0, 5).map(m => `${m.sku} ${m.name}`));
