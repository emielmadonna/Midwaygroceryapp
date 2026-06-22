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
  let cursor;
  do {
    const path = `/v2/catalog/list?types=ITEM,CATEGORY${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await squareRequest(path, { env, fetchImpl });
    for (const o of res.objects ?? []) {
      if (o.type === 'CATEGORY') {
        const cd = o.category_data ?? o.categoryData ?? {};
        if (cd.name) categories[o.id] = cd.name;
      } else if (o.type === 'ITEM') {
        items.push(o);
      }
    }
    cursor = res.cursor;
  } while (cursor);
  return { items, categories };
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

function variationRows(item, categoryName) {
  const it = itemDataOf(item);
  const alcoholic = it.is_alcoholic === true;
  return (it.variations ?? []).map(v => {
    const vd = variationDataOf(v);
    return {
      alcoholic,
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

export function buildStorefront({ items, categories }, categoryMap = {}) {
  const products = [];
  const espresso = [];
  const iceCream = [];

  for (const item of items) {
    const it = itemDataOf(item);
    const nameLower = String(it.name ?? '').trim().toLowerCase();
    const rows = variationRows(item, categoryMap[item.id]);

    if (MENU_ITEM_NAMES.has(nameLower)) {
      for (const r of rows) {
        if (r.priceCents <= 0) continue;
        if (nameLower === 'coffee') {
          if (COFFEE_MODIFIER_RX.test(r.variationName)) continue;
          espresso.push({ n: r.variationName || r.itemName, p: priceLabel(r.priceCents), d: '' });
        } else {
          if (ICECREAM_VESSEL_RX.test(r.variationName)) continue;
          iceCream.push({ n: r.variationName || r.itemName, p: priceLabel(r.priceCents), d: '' });
        }
      }
      continue; // bar menu items are not retail products
    }

    for (const r of rows) {
      if (r.priceCents <= 0) continue;
      if (!r.active || !r.sellable) continue;
      if (r.alcoholic) continue;
      if (EXCLUDED_CATEGORIES.has(r.category)) continue;
      if (BOOKING_SKU_RX.test(r.sku)) continue;
      products.push(r);
    }
  }

  const coffeeMenu = {};
  if (espresso.length) coffeeMenu['Espresso bar'] = espresso;
  if (iceCream.length) coffeeMenu['Ice cream'] = iceCream;

  // Sort products by category then name for a tidy grid.
  products.sort((a, b) => (a.category.localeCompare(b.category)) || a.name.localeCompare(b.name));

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
