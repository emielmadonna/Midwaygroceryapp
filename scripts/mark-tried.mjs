// Records the SKUs attempted this run so future backfills skip them (matched or not).
// Usage: node scripts/mark-tried.mjs /tmp/midway-missing.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const inPath = process.argv[2] || '/tmp/midway-missing.json';
const TRIED_PATH = 'scripts/.harbor-tried.json';

const attempted = JSON.parse(readFileSync(inPath, 'utf8')).map(x => x.sku).filter(Boolean);
const tried = new Set(existsSync(TRIED_PATH) ? JSON.parse(readFileSync(TRIED_PATH, 'utf8')) : []);
for (const s of attempted) tried.add(s);
writeFileSync(TRIED_PATH, JSON.stringify([...tried]));
console.log(`Marked ${attempted.length} SKUs tried; ${tried.size} total in cache.`);
