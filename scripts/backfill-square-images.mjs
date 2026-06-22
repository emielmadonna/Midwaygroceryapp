// One-time / re-runnable backfill: upload Harbor product images onto Square catalog items.
// Input: a JSON file of [{ id, sku, imageUrl }] (Square ITEM id + Harbor image URL).
// Usage: node scripts/backfill-square-images.mjs /tmp/midway-matches.json
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const MATCHES_PATH = process.argv[2] || '/tmp/midway-matches.json';
const TOKEN = (readFileSync('.env.local', 'utf8').match(/^SQUARE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!TOKEN) { console.error('Missing SQUARE_ACCESS_TOKEN in .env.local'); process.exit(1); }
const BASE = 'https://connect.squareup.com';
const VERSION = '2026-01-22';

const matches = JSON.parse(readFileSync(MATCHES_PATH, 'utf8'));
console.log(`Loaded ${matches.length} matches from ${MATCHES_PATH}`);

const results = { ok: [], failed: [] };

for (let i = 0; i < matches.length; i++) {
  const m = matches[i];
  if (!m?.id || !m?.imageUrl) { results.failed.push({ ...m, error: 'missing id/imageUrl' }); continue; }
  try {
    // 1. download the Harbor CDN image
    const imgRes = await fetch(m.imageUrl);
    if (!imgRes.ok) throw new Error(`image download ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    // Harbor's CDN often serves application/octet-stream, which Square rejects.
    // Derive the type from the URL extension instead.
    const urlLc = m.imageUrl.toLowerCase();
    let contentType = 'image/jpeg', ext = 'jpg';
    if (urlLc.includes('.png')) { contentType = 'image/png'; ext = 'png'; }
    else if (urlLc.includes('.gif')) { contentType = 'image/gif'; ext = 'gif'; }

    // 2. upload to Square + attach to the item as its primary image
    const request = {
      idempotency_key: `harbor-img-${m.id}`.slice(0, 128),
      object_id: m.id,
      is_primary: true,
      image: { type: 'IMAGE', id: '#harbor', image_data: { caption: `Harbor ${m.sku || ''}`.trim() } },
    };
    const form = new FormData();
    form.append('request', JSON.stringify(request));
    form.append('image_file', new Blob([buf], { type: contentType }), `item-${m.id}.${ext}`);

    const up = await fetch(`${BASE}/v2/catalog/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Square-Version': VERSION },
      body: form,
    });
    const body = await up.json();
    if (!up.ok || body.errors) throw new Error(JSON.stringify(body.errors || body).slice(0, 200));
    results.ok.push({ id: m.id, sku: m.sku, imageId: body.image?.id });
  } catch (err) {
    results.failed.push({ id: m.id, sku: m.sku, error: String(err.message || err) });
  }
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${matches.length} processed (ok=${results.ok.length}, failed=${results.failed.length})`);
  await sleep(120); // gentle pacing for Square rate limits
}

writeFileSync('/tmp/backfill-results.json', JSON.stringify(results, null, 2));
console.log(`\nDone. uploaded=${results.ok.length}  failed=${results.failed.length}`);
if (results.failed.length) console.log('First failures:', results.failed.slice(0, 5));
