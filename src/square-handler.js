import { listSquareCatalogItems, squareRequest } from './lib/square-api.js';
import { normalizeSquareProducts } from './lib/public-bootstrap.js';

export async function getSquareProducts(options = {}) {
  const items = await listSquareCatalogItems(options);
  return normalizeSquareProducts(items).map(product => ({
    id: product.id,
    variationId: product.variationId,
    name: product.name,
    description: product.description,
    price: product.priceCents,
    emoji: 'Store',
  }));
}

export async function getInventoryCounts(variationIds, options = {}) {
  if (!variationIds?.length) return [];
  const locationId = options.env?.locationId;
  const result = await squareRequest('/v2/inventory/counts/batch-retrieve', {
    ...options,
    method: 'POST',
    body: {
      catalog_object_ids: variationIds,
      location_ids: locationId ? [locationId] : undefined,
    },
  });
  return result.counts ?? [];
}

export async function syncSquareToSupabase() {
  throw new Error('Legacy Square-to-Supabase sync is disabled. Use the provider adapter API path instead.');
}

export async function addSquareProduct() {
  throw new Error('Direct Square catalog writes are disabled until owner approval and audit logging are implemented.');
}

export async function deleteSquareProduct() {
  throw new Error('Direct Square catalog deletes are disabled until owner approval and audit logging are implemented.');
}

export async function updateSquareInventory() {
  throw new Error('Direct Square inventory writes are disabled until owner approval and audit logging are implemented.');
}
