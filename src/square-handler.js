import { createClient } from '@supabase/supabase-js';

// Square Client Initialization
const client = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN || '',
    environment: Environment.Sandbox,
});

// Supabase Admin
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { catalogApi, inventoryApi } = client;

/**
 * Fetches inventory counts for a list of variation IDs
 */
export async function getInventoryCounts(variationIds) {
    try {
        const response = await inventoryApi.batchRetrieveInventoryCounts({
            catalogObjectIds: variationIds,
            locationIds: [process.env.SQUARE_LOCATION_ID]
        });
        return response.result.counts || [];
    } catch (error) {
        console.error('[Square Error] Failed to fetch inventory counts:', error);
        return [];
    }
}

/**
 * Updates stock quantity for a specific item variation in Square
 */
export async function updateSquareInventory(variationId, quantity) {
    try {
        await inventoryApi.batchChangeInventory({
            idempotencyKey: crypto.randomUUID(),
            changes: [{
                type: 'PHYSICAL_COUNT',
                physicalCount: {
                    referenceId: `count-${Date.now()}`,
                    catalogObjectId: variationId,
                    locationId: process.env.SQUARE_LOCATION_ID,
                    state: 'IN_STOCK',
                    quantity: quantity.toString(),
                    occurredAt: new Date().toISOString()
                }
            }]
        });
        return true;
    } catch (error) {
        console.error('[Square Error] Failed to update inventory:', error);
        return false;
    }
}

/**
 * Synchronizes Square Catalog with Supabase store_inventory
 */
export async function syncSquareToSupabase() {
    try {
        const products = await getSquareProducts();

        // Clear old inventory or handle Upsert (Upsert is safer)
        for (const p of products) {
            await supabase.from('store_inventory').upsert({
                square_id: p.id,
                name: p.name,
                description: p.description,
                price: Number(p.price) / 100, // Convert cents to dollars
                updated_at: new Date()
            }, { onConflict: 'square_id' });
        }

        console.log(`[Sync] Updated ${products.length} products to Supabase.`);
    } catch (error) {
        console.error('[Sync Error]', error);
    }
}

/**
 * Fetches all products from the Square catalog
 */
export async function getSquareProducts() {
    try {
        const response = await catalogApi.listCatalog(undefined, 'ITEM');
        const items = response.result.objects || [];

        return items.map(item => ({
            id: item.id,
            variationId: item.itemData.variations?.[0]?.id, // Required for inventory updates
            name: item.itemData.name,
            description: item.itemData.description,
            price: item.itemData.variations?.[0]?.itemVariationData?.priceMoney?.amount || 0,
            emoji: '🛒'
        }));
    } catch (error) {
        console.error('[Square Error] Failed to fetch products:', error);
        return [];
    }
}

/**
 * Adds a new product to Square Catalog
 */
export async function addSquareProduct(name, price, description = '') {
    try {
        const response = await catalogApi.upsertCatalogObject({
            idempotencyKey: crypto.randomUUID(),
            object: {
                type: 'ITEM',
                id: `#new-${Date.now()}`,
                itemData: {
                    name,
                    description,
                    variations: [{
                        type: 'ITEM_VARIATION',
                        id: `#var-${Date.now()}`,
                        itemVariationData: {
                            name: 'Regular',
                            pricingType: 'FIXED_PRICING',
                            priceMoney: {
                                amount: BigInt(Math.round(price * 100)),
                                currency: 'USD'
                            }
                        }
                    }]
                }
            }
        });
        return response.result.catalogObject;
    } catch (error) {
        console.error('[Square Error] Failed to add product:', error);
        throw error;
    }
}

/**
 * Deletes a product from Square Catalog
 */
export async function deleteSquareProduct(objectId) {
    try {
        await catalogApi.deleteCatalogObject(objectId);
        return true;
    } catch (error) {
        console.error('[Square Error] Failed to delete product:', error);
        return false;
    }
}
