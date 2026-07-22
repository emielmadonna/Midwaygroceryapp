// Generates branded HTML reports from /tmp/restock.json (+ optional harbor match data).
// Render to PDF with headless Chrome (see run command). No network, no writes to Square.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const data = JSON.parse(readFileSync('/tmp/restock.json', 'utf8'));
let harbor = {};
try { harbor = JSON.parse(readFileSync('/tmp/harbor-match.json', 'utf8')); } catch {}
const OUT = '/Users/emielmadonna/Projects/Websites/Midway/reports';
mkdirSync(OUT, { recursive: true });

const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n || 0).toLocaleString('en-US');
const date = new Date(data.generatedAt);
const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const SHELL = (title, subtitle, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1f2933; margin: 0; font-size: 12px; }
  .head { display:flex; align-items:flex-end; justify-content:space-between; border-bottom: 3px solid #1b4332; padding-bottom: 14px; margin-bottom: 18px; }
  .brand { font-size: 13px; letter-spacing: 3px; text-transform: uppercase; color: #1b4332; font-weight: 700; }
  .brand small { display:block; letter-spacing: 1px; font-size: 9px; color:#52796f; font-weight:500; margin-top:2px; }
  h1 { font-size: 24px; margin: 6px 0 2px; color:#1b4332; }
  .sub { color:#6b7280; font-size: 11px; }
  .meta { text-align:right; font-size: 10px; color:#6b7280; line-height:1.5; }
  .cards { display:flex; gap:12px; margin: 0 0 20px; }
  .card { flex:1; background:#f0f4f1; border:1px solid #d8e3dc; border-radius:10px; padding:12px 14px; }
  .card .k { font-size: 9px; text-transform:uppercase; letter-spacing:1px; color:#52796f; font-weight:600; }
  .card .v { font-size: 22px; font-weight:700; color:#1b4332; margin-top:3px; }
  .card .v small { font-size: 12px; color:#6b7280; font-weight:500; }
  table { width:100%; border-collapse: collapse; margin-bottom: 16px; }
  th { text-align:left; font-size: 9px; text-transform:uppercase; letter-spacing:.5px; color:#6b7280; border-bottom:2px solid #1b4332; padding:7px 8px; }
  td { padding:7px 8px; border-bottom:1px solid #eceff1; }
  tr:nth-child(even) td { background:#fafbfa; }
  .r { text-align:right; font-variant-numeric: tabular-nums; }
  .rank { color:#9aa5b1; font-weight:700; width:24px; }
  .name { font-weight:600; }
  .tag { display:inline-block; font-size:8px; padding:2px 6px; border-radius:20px; font-weight:700; letter-spacing:.3px; }
  .t-house { background:#fef3c7; color:#92400e; }
  .t-whole { background:#dcfce7; color:#166534; }
  .pos { color:#166534; font-weight:600; } .neg { color:#b91c1c; font-weight:600; }
  h2 { font-size: 14px; color:#1b4332; margin: 22px 0 8px; border-left:4px solid #d97706; padding-left:8px; }
  .foot { margin-top:18px; padding-top:10px; border-top:1px solid #e5e7eb; font-size:9px; color:#9aa5b1; display:flex; justify-content:space-between; }
  .bar { height:6px; background:#1b4332; border-radius:3px; display:inline-block; vertical-align:middle; }
  .total-row td { border-top:2px solid #1b4332; font-weight:700; font-size:13px; color:#1b4332; background:#f0f4f1 !important; }
</style></head><body>
  <div class="head">
    <div><div class="brand">Midway General Store <small>Campground &middot; Leavenworth, WA</small></div><h1>${title}</h1><div class="sub">${subtitle}</div></div>
    <div class="meta">Generated ${dateStr}<br>Square &middot; Location ${data.location}<br>${data.windowDays}-day window</div>
  </div>
  ${body}
  <div class="foot"><span>Midway General Store &mdash; Inventory Intelligence</span><span>Source: Square POS &middot; Confidential</span></div>
</body></html>`;

// ---------- REPORT 1: TOP SELLERS ----------
function topSellersReport() {
  const top = data.topByRevenue.slice(0, 25);
  const maxRev = top[0]?.revenue60d || 1;
  const houseRev = data.topByRevenue.filter(r => !r.reorderable).reduce((s, r) => s + r.revenue60d, 0);
  const wholeRev = data.topByRevenue.filter(r => r.reorderable).reduce((s, r) => s + r.revenue60d, 0);
  const unitsSold = data.topByUnits.reduce((s, r) => s + r.sold60d, 0);

  const cards = `<div class="cards">
    <div class="card"><div class="k">Revenue (${data.windowDays}d)</div><div class="v">${usd(data.totalRevenue)}</div></div>
    <div class="card"><div class="k">Units Sold</div><div class="v">${num(unitsSold)}</div></div>
    <div class="card"><div class="k">Items With Sales</div><div class="v">${data.topByUnits.length}<small> / ${data.all.length}</small></div></div>
    <div class="card"><div class="k">In-House vs Wholesale</div><div class="v" style="font-size:15px">${usd(houseRev)}<small> house</small><br>${usd(wholeRev)}<small> resale</small></div></div>
  </div>`;

  const rows = top.map((r, i) => `<tr>
    <td class="rank">${i + 1}</td>
    <td class="name">${esc(r.name)}</td>
    <td><span class="tag ${r.reorderable ? 't-whole' : 't-house'}">${r.reorderable ? 'RESALE' : 'IN-HOUSE'}</span></td>
    <td class="r">${num(r.sold60d)}</td>
    <td class="r">${usd(r.retailPrice)}</td>
    <td class="r">${usd(r.revenue60d)}</td>
    <td style="width:120px"><span class="bar" style="width:${Math.max(4, (r.revenue60d / maxRev) * 100)}px"></span></td>
  </tr>`).join('');

  const body = `${cards}
    <h2>Top 25 Sellers by Revenue</h2>
    <table><thead><tr><th></th><th>Item</th><th>Type</th><th class="r">Units</th><th class="r">Price</th><th class="r">Revenue</th><th>Share</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  writeFileSync(`${OUT}/top-sellers.html`, SHELL('Top Sellers Report', `Best-performing items over the last ${data.windowDays} days`, body));
}

// ---------- REPORT 2: RESTOCK ORDER ----------
function restockReport() {
  const matched = harbor.items || [];
  const byId = new Map(matched.map(m => [m.sku, m]));
  const rows = data.candidates.map((r) => {
    const m = byId.get(r.sku);
    const cost = m?.unitCost ?? null;
    const ext = cost != null ? cost * r.suggestedOrderUnits : null;
    return { ...r, harborItem: m?.itemNumber ?? null, harborName: m?.name ?? null, matchType: m?.matchType ?? null, unitCost: cost, ext };
  });
  const orderTotal = rows.reduce((s, r) => s + (r.ext || 0), 0);
  const retailValue = rows.reduce((s, r) => s + r.suggestedOrderUnits * r.retailPrice, 0);
  const matchedCount = rows.filter(r => r.harborItem).length;

  const cards = `<div class="cards">
    <div class="card"><div class="k">Items to Reorder</div><div class="v">${rows.length}</div></div>
    <div class="card"><div class="k">Total Units</div><div class="v">${rows.reduce((s, r) => s + r.suggestedOrderUnits, 0)}</div></div>
    <div class="card"><div class="k">Est. Order Cost</div><div class="v">${harbor.items ? usd(orderTotal) : '&mdash;'}</div></div>
    <div class="card"><div class="k">Retail Value</div><div class="v">${usd(retailValue)}</div></div>
  </div>
  <div class="sub" style="margin:-8px 0 16px">Lean weekly reorder &middot; target ${data.coverWeeks} weeks of cover at current velocity${harbor.items ? ` &middot; ${matchedCount}/${rows.length} matched to HarborHub catalog` : ' &middot; HarborHub costs pending login'}</div>`;

  const rowsHtml = rows.map((r) => `<tr>
    <td class="name">${esc(r.name)}</td>
    <td>${r.sku || '&mdash;'}</td>
    <td class="r ${r.onHand < 0 ? 'neg' : ''}">${r.onHand ?? '&mdash;'}</td>
    <td class="r">${num(r.sold60d)}</td>
    <td class="r">${r.velocityPerWeek}</td>
    <td class="r"><b>${r.suggestedOrderUnits}</b></td>
    <td>${r.harborItem ? `${r.harborItem} <span class="tag ${r.matchType === 'item' ? 't-whole' : 't-house'}">${(r.matchType || '').toUpperCase()}</span>` : (harbor.items ? '<span class="neg">no match</span>' : '&mdash;')}</td>
    <td class="r">${r.unitCost != null ? usd(r.unitCost) : '&mdash;'}</td>
    <td class="r">${r.ext != null ? usd(r.ext) : '&mdash;'}</td>
  </tr>`).join('');

  const totalRow = harbor.items ? `<tr class="total-row"><td colspan="8">Estimated Order Total</td><td class="r">${usd(orderTotal)}</td></tr>` : '';

  const body = `${cards}
    <h2>Weekly Restock &mdash; Low Stock &amp; Selling</h2>
    <table><thead><tr><th>Item</th><th>SKU</th><th class="r">On Hand</th><th class="r">Sold ${data.windowDays}d</th><th class="r">Vel/wk</th><th class="r">Order</th><th>HarborHub #</th><th class="r">Unit Cost</th><th class="r">Ext. Cost</th></tr></thead>
    <tbody>${rowsHtml}${totalRow}</tbody></table>`;
  writeFileSync(`${OUT}/restock-order.html`, SHELL('Weekly Restock Order', 'Low-stock items with active sales &mdash; reorder plan', body));
}

function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

topSellersReport();
restockReport();
console.log('Wrote HTML to', OUT, harbor.items ? '(with HarborHub costs)' : '(restock costs pending Harbor login)');
