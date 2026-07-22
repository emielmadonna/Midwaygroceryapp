import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandCenterService } from '../src/lib/command-center-service.js';

function makeStore() {
  const inventory = [
    {
      squareVariationId: 'VAR_COFFEE',
      squareItemId: 'ITEM_COFFEE',
      name: 'Coffee',
      sku: 'COFFEE',
      category: 'Grocery',
      active: true,
    },
    {
      squareVariationId: 'VAR_ICE',
      squareItemId: 'ITEM_ICE',
      name: 'Bagged Ice',
      sku: 'ICE',
      category: 'Convenience',
      active: true,
    },
  ];
  return {
    async listStoreInventory() { return inventory; },
    async upsertStoreInventory(rows) { inventory.splice(0, inventory.length, ...rows); return rows; },
    async adminDashboard() { return { arrivals: [] }; },
    async listFuelInventory() { return []; },
    async listFuelPrices() { return []; },
    async recordAuditLog() {},
  };
}

test('command center inventory rules surface low stock in the overview', async () => {
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({}),
    now: () => new Date('2026-07-16T12:00:00Z'),
  });

  await service.updateInventoryRule({
    squareVariationId: 'VAR_COFFEE',
    reorderPoint: 5,
    targetStock: 18,
  });
  const inventory = await service.listInventory();
  const overview = await service.getOverview();
  const coffee = inventory.find(item => item.squareVariationId === 'VAR_COFFEE');

  assert.equal(coffee.name, 'Coffee');
  assert.equal(coffee.quantity, null);
  assert.equal(coffee.reorderPoint, 5);
  assert.equal(coffee.isLowStock, false, 'an unknown count must not be presented as low stock');
  assert.equal(overview.metrics.inventoryItems, 2);
  assert.equal(overview.square.status, 'not_connected');
  assert.equal(overview.vendors[0].name, 'Harbor Wholesale');
});

test('live inventory refreshes Square catalog and counts before returning numbers', async () => {
  const calls = [];
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: async (url, options = {}) => {
      calls.push(url);
      if (url.includes('/v2/catalog/list')) {
        return new Response(JSON.stringify({ objects: [{ id: 'ITEM_LIVE', updated_at: '2026-07-16T12:00:00Z', item_data: { name: 'Live Coffee', variations: [{ id: 'VAR_LIVE', item_variation_data: { sku: 'LIVE', price_money: { amount: 500, currency: 'USD' } } }] } }] }), { status: 200 });
      }
      assert.match(url, /inventory\/counts\/batch-retrieve/);
      assert.equal(JSON.parse(options.body).location_ids[0], 'MIDWAY');
      return new Response(JSON.stringify({ counts: [{ catalog_object_id: 'VAR_LIVE', location_id: 'MIDWAY', state: 'IN_STOCK', quantity: '7', calculated_at: '2026-07-16T12:01:00Z' }] }), { status: 200 });
    },
  });

  const first = await service.listInventory({ live: true });
  const second = await service.listInventory({ live: true });
  assert.equal(first[0].name, 'Live Coffee');
  assert.equal(first[0].quantity, 7);
  assert.equal(second[0].quantity, 7);
  assert.equal(calls.filter(url => url.includes('/v2/catalog/list')).length, 1, 'nearby live reads should share the short Square cache');
});

test('today sales use the store timezone instead of the server timezone', async () => {
  let paymentUrl = '';
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox', timezone: 'America/Los_Angeles' }),
    fetchImpl: async url => { paymentUrl = url; return new Response(JSON.stringify({ payments: [] }), { status: 200 }); },
    now: () => new Date('2026-07-18T02:00:00Z'),
  });

  await service.getSquareSnapshot();
  const params = new URL(paymentUrl).searchParams;
  assert.equal(params.get('begin_time'), '2026-07-17T07:00:00.000Z');
  assert.equal(params.get('end_time'), '2026-07-18T07:00:00.000Z');
});

test('command center creates vendors and keeps order sending as a draft-only action', async () => {
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({}),
    now: () => new Date('2026-07-16T12:00:00Z'),
  });
  const vendor = await service.createVendor({ name: 'Northwest Foods', orderingMethod: 'mcp' });
  const order = await service.draftReorder({
    vendorId: vendor.id,
    items: [{ name: 'Coffee', squareVariationId: 'VAR_COFFEE', quantity: 3, unitCostCents: 700 }],
    notes: 'Review before sending',
  });

  assert.equal(vendor.slug, 'northwest-foods');
  assert.equal(order.status, 'draft');
  assert.equal(order.subtotalCents, 2100);
  assert.equal((await service.listPurchaseOrders()).length, 1);
});

test('vendor MCP connections expose tools without exposing credential references', async () => {
  const methods = [];
  const authorizations = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    methods.push(body.method);
    authorizations.push(options.headers.Authorization);
    const result = body.method === 'tools/list'
      ? { tools: [{ name: 'inventory.lookup', description: 'Look up vendor stock' }] }
      : {};
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({}),
    fetchImpl,
    env: { NODE_ENV: 'test', ADMIN_SESSION_SECRET: 'test-encryption-secret' },
  });
  const connector = await service.createConnector({
    vendorId: '00000000-0000-4000-8000-000000000001',
    displayName: 'Harbor MCP',
    endpointUrl: 'http://127.0.0.1:8787/mcp',
    authToken: 'private-token',
  });
  const tested = await service.testConnector(connector.id);

  assert.equal(connector.secretRef, undefined);
  assert.equal(connector.secretConfigured, true);
  assert.equal(tested.status, 'connected');
  assert.deepEqual(tested.capabilities, [{ name: 'inventory.lookup', description: 'Look up vendor stock' }]);
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list']);
  assert.ok(authorizations.every(value => value === 'Bearer private-token'));
});

test('vendor connectors can store an encrypted email and password sign-in', async () => {
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({}),
    env: { NODE_ENV: 'test', ADMIN_SESSION_SECRET: 'test-encryption-secret' },
  });
  const connector = await service.createConnector({
    vendorId: '00000000-0000-4000-8000-000000000001',
    displayName: 'Harbor sign-in',
    endpointUrl: 'http://127.0.0.1:8787/mcp',
    authType: 'login',
    email: 'owner@midway.test',
    password: 'harbor-password',
  });

  assert.equal(connector.authType, 'login');
  assert.equal(connector.secretConfigured, true);
  assert.equal(connector.encryptedCredentials, undefined);
  assert.equal(JSON.stringify(connector).includes('harbor-password'), false);

  await assert.rejects(
    service.createConnector({
      vendorId: '00000000-0000-4000-8000-000000000001',
      displayName: 'Harbor missing password',
      endpointUrl: 'http://127.0.0.1:8787/mcp',
      authType: 'login',
      email: 'owner@midway.test',
    }),
    error => error.code === 'CONNECTOR_LOGIN_REQUIRED',
  );
});

test('vendor connector credentials can be replaced without recreating the connection', async () => {
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({}),
    env: { NODE_ENV: 'test', ADMIN_SESSION_SECRET: 'test-encryption-secret' },
  });
  const connector = await service.createConnector({
    vendorId: '00000000-0000-4000-8000-000000000001',
    displayName: 'Harbor ordering',
    endpointUrl: 'http://127.0.0.1:8787/mcp',
    authType: 'none',
  });

  const updated = await service.updateConnectorCredentials(connector.id, {
    authType: 'login',
    email: 'owner@midway.test',
    password: 'new-harbor-password',
  });

  assert.equal(updated.authType, 'login');
  assert.equal(updated.secretConfigured, true);
  assert.equal(updated.status, 'not_tested');

  await assert.rejects(
    service.updateConnectorCredentials('missing-connector', { authType: 'login', email: 'a@b.c', password: 'x' }),
    error => error.code === 'CONNECTOR_NOT_FOUND',
  );
});

test('command center persists upload metadata before a file is sent to the agent', async () => {
  const service = createCommandCenterService({ store: makeStore() });
  const upload = await service.saveUpload({
    fileName: 'July count sheet.csv',
    contentType: 'text/csv',
    buffer: Buffer.from('sku,count\nCOFFEE,4'),
    actor: { email: 'owner@midway.test' },
    conversationId: 'conversation-1',
  });

  assert.equal(upload.fileName, 'July-count-sheet.csv');
  assert.equal(upload.uploadedBy, 'owner@midway.test');
  assert.equal(upload.conversationId, 'conversation-1');
  assert.equal((await service.listUploads({ conversationId: 'conversation-1' })).length, 1);
});

test('inventory reconciliation reviews a count before applying it to Square', async () => {
  const requests = [];
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ counts: [], changes: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    now: () => new Date('2026-07-16T12:00:00Z'),
  });

  const review = await service.createReconciliation({
    lines: [{ squareVariationId: 'VAR_COFFEE', countedQuantity: 4 }],
    actor: { email: 'owner@midway.test' },
  });
  assert.equal(review.status, 'review');
  assert.equal(review.lines[0].countedQuantity, 4);
  assert.equal(requests.length, 0, 'reviewing must not write to Square');

  const applied = await service.applyReconciliation({ reconciliationId: review.id, actor: { email: 'owner@midway.test' } });
  assert.equal(applied.status, 'resolved');
  assert.match(requests[0].url, /inventory\/changes\/batch-create/);
  assert.equal(requests[0].body.changes[0].physical_count.quantity, '4');
});

test('sales history sync is idempotent and produces item-level analytics', async () => {
  let calls = 0;
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox', timezone: 'America/Los_Angeles' }),
    fetchImpl: async url => {
      assert.match(url, /\/v2\/orders\/search$/); calls += 1;
      return new Response(JSON.stringify({ orders: [{ id: 'ORDER-1', location_id: 'MIDWAY', state: 'COMPLETED', closed_at: '2026-07-16T18:00:00Z', updated_at: '2026-07-16T18:01:00Z', total_money: { amount: 650, currency: 'USD' }, total_tax_money: { amount: 50 }, line_items: [{ uid: 'LINE-1', catalog_object_id: 'VAR_COFFEE', name: 'Coffee', quantity: '2', gross_sales_money: { amount: 600 }, total_discount_money: { amount: 0 }, total_tax_money: { amount: 50 }, total_money: { amount: 650, currency: 'USD' } }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    now: () => new Date('2026-07-16T20:00:00Z'),
  });
  await service.syncSalesHistory({ days: 365, actor: { email: 'owner@midway.test' } });
  await service.syncSalesHistory({ days: 365, actor: { email: 'owner@midway.test' } });
  const analytics = await service.getSalesAnalytics({ days: 30 });

  assert.equal(calls, 2);
  assert.equal(analytics.summary.unitsSold, 2, 're-syncing must replace facts rather than duplicate sales');
  assert.equal(analytics.summary.netSalesCents, 600);
  assert.equal(analytics.topItems[0].name, 'Coffee');
});
