import test from 'node:test';
import assert from 'node:assert/strict';

import { createVendorMappingSweep, deriveCaseTerms, findExactUpcMatch } from '../src/lib/vendor-mapping-sweep.js';

function mcpJson(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function fakeCommandCenter({ onConnectorTool, onMapVendorProduct } = {}) {
  const calls = { connectorTool: [], mapVendorProduct: [] };
  return {
    calls,
    async listInventory() {
      return [
        { squareVariationId: 'sq-marlboro', name: 'Marlboro Red', sku: '028200003843', vendorId: null, quantity: 4 },
        { squareVariationId: 'sq-fountain', name: 'Fountain Drink', sku: 'FTN-32', vendorId: null, quantity: 99 },
        { squareVariationId: 'sq-snickers', name: 'Snickers', sku: '040000424314', vendorId: 'vendor-1', quantity: 7 },
        { squareVariationId: 'sq-flaky', name: 'Flaky Chips', sku: '11112222', vendorId: null, quantity: 2 },
      ];
    },
    async callConnectorTool(request) {
      calls.connectorTool.push(request);
      return onConnectorTool(request);
    },
    async mapVendorProduct(record) {
      calls.mapVendorProduct.push(record);
      if (onMapVendorProduct) return onMapVendorProduct(record);
      return { id: `mapping-${record.squareVariationId}` };
    },
  };
}

const marlboroSearch = mcpJson({
  success: true,
  data: {
    Items: [
      { ItemID: 'H-778', ItemDescription: 'MARLBORO RED BOX KING', BrandName: 'Marlboro', RetailUPC: '028200003843' },
      { ItemID: 'H-999', ItemDescription: 'MARLBORO GOLD BOX', BrandName: 'Marlboro', RetailUPC: '028200003850' },
    ],
  },
});

const marlboroProduct = mcpJson({
  success: true,
  data: {
    ItemID: 'H-778',
    BuyingOptions: [
      { code: 'EA', name: 'Each', retailUnits: 1, unitPrice: 9.5, pricePerRetailUnit: 9.5 },
      { code: 'CT', name: 'Carton', retailUnits: 10, unitPrice: 92.5, pricePerRetailUnit: 9.25, isDefault: true },
    ],
  },
});

test('propose builds an exact-UPC proposal with case pack and unit cost from BuyingOptions', async () => {
  const commandCenter = fakeCommandCenter({
    onConnectorTool: ({ toolName, arguments: args }) => {
      if (toolName === 'harbor_search_by_upc' && args.upc === '028200003843') return marlboroSearch;
      if (toolName === 'harbor_search_by_upc' && args.upc === '11112222') throw new Error('vendor timeout');
      if (toolName === 'harbor_get_product' && args.itemId === 'H-778') return marlboroProduct;
      throw new Error(`unexpected vendor call ${toolName}`);
    },
  });
  const sweep = createVendorMappingSweep({ commandCenter });
  const result = await sweep.propose({});

  assert.equal(result.scannedCount, 2);
  assert.equal(result.proposals.length, 1);
  assert.deepEqual(result.proposals[0], {
    squareVariationId: 'sq-marlboro',
    name: 'Marlboro Red',
    upc: '028200003843',
    vendorItemId: 'H-778',
    vendorDescription: 'MARLBORO RED BOX KING',
    brand: 'Marlboro',
    casePack: 10,
    unitCostCents: 925,
    confidence: 'exact_upc',
  });

  // Non-UPC skus and already-mapped items are skipped with reasons, and a
  // vendor failure is recorded instead of aborting the sweep.
  assert.deepEqual(result.skipped.find(item => item.name === 'Fountain Drink'), { name: 'Fountain Drink', reason: 'no_upc' });
  assert.deepEqual(result.skipped.find(item => item.name === 'Snickers'), { name: 'Snickers', reason: 'already_mapped' });
  const failure = result.skipped.find(item => item.name === 'Flaky Chips');
  assert.equal(failure.reason, 'search_failed');
  assert.equal(failure.upc, '11112222');
  assert.match(failure.error, /vendor timeout/);

  // All vendor lookups go through the read-only path.
  assert.ok(commandCenter.calls.connectorTool.every(call => call.readOnly === true));
});

test('propose keeps the match but leaves pack and cost null when BuyingOptions are unusable', async () => {
  const commandCenter = fakeCommandCenter({
    onConnectorTool: ({ toolName, arguments: args }) => {
      if (toolName === 'harbor_search_by_upc' && args.upc === '028200003843') return marlboroSearch;
      if (toolName === 'harbor_search_by_upc') return mcpJson({ success: false, error: 'not found' });
      if (toolName === 'harbor_get_product') {
        return mcpJson({ success: true, data: { ItemID: 'H-778', BuyingOptions: [{ code: 'EA', retailUnits: 1, unitPrice: 9.5 }] } });
      }
      throw new Error(`unexpected vendor call ${toolName}`);
    },
  });
  const sweep = createVendorMappingSweep({ commandCenter });
  const result = await sweep.propose({ vendorId: 'vendor-1' });

  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].casePack, null);
  assert.equal(result.proposals[0].unitCostCents, null);
  assert.equal(result.skipped.find(item => item.name === 'Flaky Chips').reason, 'search_failed');
  // The vendorId is forwarded so the sweep hits the right connection.
  assert.ok(commandCenter.calls.connectorTool.every(call => call.connectorId === 'vendor-1'));
});

test('apply maps every proposal and reports a failure without aborting the rest', async () => {
  const commandCenter = fakeCommandCenter({
    onMapVendorProduct: record => {
      if (record.squareVariationId === 'sq-bad') throw new Error('vendor not found');
      return { id: 'mapping-1' };
    },
  });
  const sweep = createVendorMappingSweep({ commandCenter });
  const result = await sweep.apply({
    vendorId: 'vendor-1',
    proposals: [
      { squareVariationId: 'sq-bad', name: 'Broken Item', vendorItemId: 'H-000' },
      { squareVariationId: 'sq-marlboro', name: 'Marlboro Red', vendorItemId: 'H-778', casePack: 10, unitCostCents: 925 },
    ],
  });

  assert.equal(result.requestedCount, 2);
  assert.equal(result.mappedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.failures, [{ squareVariationId: 'sq-bad', name: 'Broken Item', error: 'vendor not found' }]);
  assert.equal(commandCenter.calls.mapVendorProduct.length, 2);
  assert.deepEqual(commandCenter.calls.mapVendorProduct[1], {
    squareVariationId: 'sq-marlboro',
    vendorId: 'vendor-1',
    vendorSku: 'H-778',
    casePack: 10,
    unitCostCents: 925,
  });
});

test('helpers tolerate leading zeros and missing case options', () => {
  const items = [{ ItemID: 'H-1', RetailUPC: '0028200003843' }];
  assert.equal(findExactUpcMatch({ Items: items }, '028200003843')?.ItemID, 'H-1');
  assert.equal(findExactUpcMatch({ Items: items }, '028200003850'), null);
  assert.deepEqual(deriveCaseTerms([{ code: 'EA', retailUnits: 1, unitPrice: 2 }]), { casePack: null, unitCostCents: null });
  assert.deepEqual(
    deriveCaseTerms([{ code: 'CS', retailUnits: 6, unitPrice: 12 }]),
    { casePack: 6, unitCostCents: 200 },
  );
});
