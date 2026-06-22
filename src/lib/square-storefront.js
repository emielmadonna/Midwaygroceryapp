import { squareRequest } from './square-api.js';

// Builds the public storefront from the live Square catalog:
//   - products:   retail variation rows (for the Order Ahead grid), tagged with real category names
//   - coffeeMenu: the made-to-order bar menu derived from the "Coffee" and "Ice Cream" items
//
// The Square catalog `list` endpoint pages at 100 objects and does NOT return
// item->category links, so we paginate and resolve categories via search-catalog-items.

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, key: '', data: null };

// Items whose variations are the made-to-order bar menu (not retail pickup).
const MENU_ITEM_NAMES = new Set(['coffee', 'ice cream']);
// Coffee add-on variations we don't list as standalone menu lines.
const COFFEE_MODIFIER_RX = /(extra shot|flavou?r|alternative milk|alt milk)/i;
// Ice-cream "vessel" variations that are $0 / not a product on their own.
const ICECREAM_VESSEL_RX = /(cup|cone|jimmies|sprinkle)/i;
const BOOKING_SKU_RX = /^MIDWAY-(RV|TENT|EXTRA)/i;
// Age-restricted categories are excluded from online order-ahead (verified at the counter only).
const EXCLUDED_CATEGORIES = new Set(['Tobacco', 'Cigarettes', 'Tobacco Accessories']);
// Safety net for alcohol that isn't flagged `is_alcoholic` in Square (e.g. boxed wine).
// Square's `is_alcoholic` flag is the real fix; this catches obvious wine/beer/spirits by name.
const ALCOHOL_NAME_RX = /\b(wine|cabernet|sauvignon|merlot|pinot|chardonnay|riesling|zinfandel|moscato|prosecco|champagne|vermouth|sangria|vodka|whiskey|whisky|bourbon|tequila|brandy|cognac|ipa|lager|pilsner|brewing|hard seltzer|hard cider|malt liquor)\b|bota box/i;

function itemDataOf(o) { return o.item_data ?? o.itemData ?? {}; }
function variationDataOf(v) { return v.item_variation_data ?? v.itemVariationData ?? {}; }
function priceCentsOf(vd) {
  const pm = vd.priceMoney ?? vd.price_money ?? {};
  const a = pm.amount;
  return typeof a === 'bigint' ? Number(a) : Number(a ?? 0);
}
function priceLabel(cents) {
  const n = cents / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export async function fetchSquareCatalog({ env, fetchImpl } = {}) {
  const items = [];
  const categories = {};
  const images = {};
  let cursor;
  do {
    const path = `/v2/catalog/list?types=ITEM,CATEGORY,IMAGE${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await squareRequest(path, { env, fetchImpl });
    for (const o of res.objects ?? []) {
      if (o.type === 'CATEGORY') {
        const cd = o.category_data ?? o.categoryData ?? {};
        if (cd.name) categories[o.id] = cd.name;
      } else if (o.type === 'IMAGE') {
        const url = (o.image_data ?? o.imageData ?? {}).url;
        if (url) images[o.id] = url;
      } else if (o.type === 'ITEM') {
        items.push(o);
      }
    }
    cursor = res.cursor;
  } while (cursor);
  return { items, categories, images };
}

// Map squareItemId -> category name by querying each category's items.
async function fetchItemCategoryMap({ env, fetchImpl, categories }) {
  const map = {};
  for (const [categoryId, categoryName] of Object.entries(categories)) {
    let cursor;
    do {
      const res = await squareRequest('/v2/catalog/search-catalog-items', {
        method: 'POST',
        env,
        fetchImpl,
        body: { category_ids: [categoryId], limit: 100, ...(cursor ? { cursor } : {}) },
      });
      for (const o of res.items ?? []) {
        if (!map[o.id]) map[o.id] = categoryName;
      }
      cursor = res.cursor;
    } while (cursor);
  }
  return map;
}

function variationRows(item, categoryName, imageUrl = null) {
  const it = itemDataOf(item);
  const alcoholic = it.is_alcoholic === true;
  return (it.variations ?? []).map(v => {
    const vd = variationDataOf(v);
    return {
      alcoholic,
      imageUrl,
      id: item.id,
      variationId: v.id,
      squareItemId: item.id,
      squareVariationId: v.id,
      sku: vd.sku ?? '',
      itemName: it.name ?? '',
      variationName: vd.name ?? '',
      name: [it.name, vd.name].filter(Boolean).join(' - ') || it.name || vd.name || '',
      description: it.description ?? '',
      priceCents: priceCentsOf(vd),
      currency: (vd.price_money ?? vd.priceMoney ?? {}).currency ?? 'USD',
      category: categoryName || 'Store',
      sellable: vd.sellable !== false,
      active: item.is_deleted !== true && it.is_archived !== true,
    };
  });
}

// Collapse per-size variations into one tidy menu line:
//   "Americano 12oz" + "Americano 16oz" -> { n:'Americano', d:'12 / 16oz', p:'$3.75 / $4.25' }
const MENU_SIZE_RX = /\s*[-–]?\s*(\d+\s*oz|small|large|sm|lg|sml|lrg)\s*$/i;
function groupMenu(rows) {
  const groups = new Map();
  for (const r of rows) {
    const m = r.name.match(MENU_SIZE_RX);
    const base = (m ? r.name.slice(0, m.index) : r.name).replace(/[-–\s]+$/, '').trim() || r.name.trim();
    const size = m ? m[1].replace(/\s+/g, '').replace(/^sml$/i, 'Small').replace(/^lrg$/i, 'Large').replace(/^sm$/i, 'Small').replace(/^lg$/i, 'Large') : '';
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push({ size, cents: r.cents });
  }
  return [...groups.values()].length
    ? [...groups].map(([base, variants]) => {
        variants.sort((a, b) => a.cents - b.cents);
        const sizes = variants.map(v => v.size).filter(Boolean);
        return {
          n: base,
          d: sizes.length ? sizes.join(' / ') : '',
          p: variants.map(v => `$${priceLabel(v.cents)}`).join(' / '),
        };
      })
    : [];
}

export function buildStorefront({ items, categories, images = {} }, categoryMap = {}) {
  const products = [];
  const espresso = [];
  const iceCream = [];

  for (const item of items) {
    const it = itemDataOf(item);
    const nameLower = String(it.name ?? '').trim().toLowerCase();
    const imageUrl = (it.image_ids ?? it.imageIds ?? []).map(id => images[id]).find(Boolean) ?? null;
    const rows = variationRows(item, categoryMap[item.id], imageUrl);

    if (MENU_ITEM_NAMES.has(nameLower)) {
      for (const r of rows) {
        if (r.priceCents <= 0) continue;
        if (nameLower === 'coffee') {
          if (COFFEE_MODIFIER_RX.test(r.variationName)) continue;
          espresso.push({ name: r.variationName || r.itemName, cents: r.priceCents });
        } else {
          if (ICECREAM_VESSEL_RX.test(r.variationName)) continue;
          iceCream.push({ name: r.variationName || r.itemName, cents: r.priceCents });
        }
      }
      continue; // bar menu items are not retail products
    }

    for (const r of rows) {
      if (r.priceCents <= 0) continue;
      if (!r.active || !r.sellable) continue;
      if (r.alcoholic) continue;
      if (ALCOHOL_NAME_RX.test(r.itemName)) continue;
      if (EXCLUDED_CATEGORIES.has(r.category)) continue;
      if (BOOKING_SKU_RX.test(r.sku)) continue;
      products.push(r);
    }
  }

  const coffeeMenu = {};
  const espressoMenu = groupMenu(espresso);
  const iceCreamMenu = groupMenu(iceCream);
  if (espressoMenu.length) coffeeMenu['Espresso bar'] = espressoMenu;
  if (iceCreamMenu.length) coffeeMenu['Ice cream'] = iceCreamMenu;

  // Products with photos first (so the grid opens visually rich), then category, then name.
  products.sort((a, b) =>
    (Boolean(b.imageUrl) - Boolean(a.imageUrl))
    || a.category.localeCompare(b.category)
    || a.name.localeCompare(b.name));

  return { products, coffeeMenu, categories: Object.values(categories) };
}

export async function getSquareStorefront({ env, fetchImpl, now = Date.now() } = {}) {
  const key = String(env?.accessToken ?? env?.access_token ?? '').slice(-10);
  if (cache.data && cache.key === key && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const catalog = await fetchSquareCatalog({ env, fetchImpl });
  const categoryMap = await fetchItemCategoryMap({ env, fetchImpl, categories: catalog.categories });
  const data = buildStorefront(catalog, categoryMap);
  cache = { at: now, key, data };
  return data;
}

export function clearSquareStorefrontCache() {
  cache = { at: 0, key: '', data: null };
}
