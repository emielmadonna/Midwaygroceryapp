import test from 'node:test';
import assert from 'node:assert/strict';

import { createMidwayHarness } from '../src/lib/midway-harness.js';
import { createTenantConfig } from '../src/lib/tenant-config.js';
import { createToolRegistry } from '../src/lib/tool-registry.js';
import { registerCoreTools } from '../src/lib/registered-tools.js';

const baseTenantConfig = createTenantConfig({
  tenantId: 'midway',
  locationId: 'plain',
  business: { name: 'Midway', publicBrandName: 'Midway', timezone: 'America/Los_Angeles' },
});

function buildHarness({ fuelPrices = [], fuelInventory = [] } = {}) {
  return createMidwayHarness({
    env: { NODE_ENV: 'test', MIDWAY_ALLOW_MEMORY_STORE: 'true' },
    fuelPrices,
    tenantConfig: baseTenantConfig,
    // Inventory is loaded from Supabase only — for the no-supabase path it is empty.
    // The harness falls back to state.fuelPrices for prices, which we set here.
  });
}

test('listFuelPrices returns seeded prices when no supabase', async () => {
  const harness = buildHarness({ fuelPrices: [{ type: 'unleaded', price: 3.89 }] });
  const prices = await harness.listFuelPrices();
  assert.equal(prices.length, 1);
  assert.equal(prices[0].type, 'unleaded');
  assert.equal(prices[0].price, 3.89);
});

test('updateFuelPrice validates type and price', async () => {
  const harness = buildHarness();
  await assert.rejects(harness.updateFuelPrice({}), /type/);
  await assert.rejects(harness.updateFuelPrice({ type: 'kerosene', price: 3 }), /type/);
  await assert.rejects(harness.updateFuelPrice({ type: 'diesel', price: -1 }), /price/);
});

test('updateFuelPrice caches state without supabase', async () => {
  const harness = buildHarness();
  await harness.updateFuelPrice({ type: 'diesel', price: 4.29 });
  const prices = await harness.listFuelPrices();
  assert.ok(prices.find(row => row.type === 'diesel' && row.price === 4.29));
});

test('listFuelInventory returns empty when no supabase', async () => {
  const harness = buildHarness();
  const tanks = await harness.listFuelInventory();
  assert.deepEqual(tanks, []);
});

test('updateFuelInventory validates type and ranges', async () => {
  const harness = buildHarness();
  await assert.rejects(harness.updateFuelInventory({}), /type/);
  await assert.rejects(harness.updateFuelInventory({ type: 'diesel', currentGallons: -5 }), /currentGallons/);
  await assert.rejects(harness.updateFuelInventory({ type: 'diesel', capacityGallons: 0 }), /capacityGallons/);
  await assert.rejects(harness.updateFuelInventory({ type: 'diesel', alertThreshold: -1 }), /alertThreshold/);
});

test('registered fuel tools execute against the harness', async () => {
  const harness = buildHarness({ fuelPrices: [{ type: 'unleaded', price: 3.99 }] });
  const registry = createToolRegistry();
  registerCoreTools(registry, { store: harness });

  const owner = { role: 'owner', scope: 'owner', actorType: 'session' };
  const list = await registry.execute('list_fuel_prices', { input: {}, actor: owner, store: harness });
  assert.ok(list.find(row => row.type === 'unleaded'));

  const updated = await registry.execute('update_fuel_price', {
    input: { type: 'diesel', price: 4.19 },
    actor: owner,
    store: harness,
  });
  assert.equal(updated.price, 4.19);

  const after = await registry.execute('list_fuel_prices', { input: {}, actor: owner, store: harness });
  assert.ok(after.find(row => row.type === 'diesel' && row.price === 4.19));
});

test('list_fuel_inventory tool is gated by feature flag', async () => {
  const harness = createMidwayHarness({
    env: {
      NODE_ENV: 'test',
      MIDWAY_ALLOW_MEMORY_STORE: 'true',
      FEATURE_FLAGS_JSON: JSON.stringify({ 'fuel.tank_levels': false }),
    },
    tenantConfig: baseTenantConfig,
  });
  const registry = createToolRegistry();
  registerCoreTools(registry, { store: harness });

  const owner = { role: 'owner', scope: 'owner', actorType: 'session' };
  await assert.rejects(
    registry.execute('list_fuel_inventory', { input: {}, actor: owner, store: harness }),
    /fuel\.tank_levels/,
  );
});
