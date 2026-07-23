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
    async removeStoreInventory({ squareItemId = null, squareVariationIds = [] } = {}) {
      const varSet = new Set((squareVariationIds ?? []).filter(Boolean));
      let removed = 0;
      for (let i = inventory.length - 1; i >= 0; i -= 1) {
        const item = inventory[i];
        if ((squareItemId && item.squareItemId === squareItemId) || varSet.has(item.squareVariationId)) { inventory.splice(i, 1); removed += 1; }
      }
      return { removed };
    },
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

test('vendor mapping saves, replaces, and removes an item-vendor link', async () => {
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({}),
    now: () => new Date('2026-07-16T12:00:00Z'),
  });

  await assert.rejects(
    service.mapVendorProduct({ squareVariationId: 'VAR_COFFEE', vendorId: 'not-a-vendor' }),
    error => error.code === 'VENDOR_NOT_FOUND',
    'unknown vendors must be rejected with a friendly error',
  );
  await assert.rejects(
    service.mapVendorProduct({ vendorId: 'whatever' }),
    error => error.code === 'INVENTORY_ITEM_REQUIRED',
  );

  const [harbor] = await service.listVendors();
  const mapping = await service.mapVendorProduct({
    squareVariationId: 'VAR_COFFEE',
    vendorId: harbor.id,
    vendorSku: '123456',
    casePack: 24,
    unitCostCents: 55,
  });
  assert.equal(mapping.vendorId, harbor.id);
  assert.equal(mapping.vendorSku, '123456');
  assert.equal(mapping.casePack, 24);
  assert.equal(mapping.unitCostCents, 55);

  let coffee = (await service.listInventory()).find(item => item.squareVariationId === 'VAR_COFFEE');
  assert.equal(coffee.vendorName, 'Harbor Wholesale');
  assert.equal(coffee.vendorSku, '123456');
  assert.equal(coffee.casePack, 24);
  assert.equal(coffee.unitCostCents, 55);

  const northwest = await service.createVendor({ name: 'Northwest Foods' });
  const replaced = await service.mapVendorProduct({ squareVariationId: 'VAR_COFFEE', vendorId: northwest.id, vendorSku: 'NW-9' });
  assert.equal(replaced.vendorId, northwest.id);
  coffee = (await service.listInventory()).find(item => item.squareVariationId === 'VAR_COFFEE');
  assert.equal(coffee.vendorName, 'Northwest Foods');
  assert.equal(coffee.vendorSku, 'NW-9');
  assert.equal(coffee.casePack, null, 'replacing a mapping must not keep stale case-pack data');

  const removal = await service.unmapVendorProduct({ squareVariationId: 'VAR_COFFEE' });
  assert.equal(removal.removed, true);
  coffee = (await service.listInventory()).find(item => item.squareVariationId === 'VAR_COFFEE');
  assert.equal(coffee.vendorId, null);
  assert.equal(coffee.vendorSku, null);
});

test('reorder point rules flip low-stock status for counted items', async () => {
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: async url => {
      if (url.includes('/v2/catalog/list')) {
        return new Response(JSON.stringify({ objects: [{ id: 'ITEM_LIVE', updated_at: '2026-07-16T12:00:00Z', item_data: { name: 'Live Coffee', variations: [{ id: 'VAR_LIVE', item_variation_data: { sku: 'LIVE', price_money: { amount: 500, currency: 'USD' } } }] } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ counts: [{ catalog_object_id: 'VAR_LIVE', location_id: 'MIDWAY', state: 'IN_STOCK', quantity: '5', calculated_at: '2026-07-16T12:01:00Z' }] }), { status: 200 });
    },
  });

  const before = (await service.listInventory({ live: true })).find(item => item.squareVariationId === 'VAR_LIVE');
  assert.equal(before.quantity, 5);
  assert.equal(before.isLowStock, false, 'without a rule, only counts of 3 or fewer read as low');

  const rule = await service.updateInventoryRule({ squareVariationId: 'VAR_LIVE', reorderPoint: 8, targetStock: 24 });
  assert.equal(rule.reorderPoint, 8);

  const after = (await service.listInventory()).find(item => item.squareVariationId === 'VAR_LIVE');
  assert.equal(after.reorderPoint, 8);
  assert.equal(after.targetStock, 24);
  assert.equal(after.isLowStock, true, 'a count at or below the reorder point counts as running low');
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

function makeMergingStore() {
  // Mirrors the real booking store: upserts merge by variation id instead of
  // replacing the list, which the stepped sync relies on between pages.
  const inventory = [];
  const auditLog = [];
  return {
    inventory,
    auditLog,
    async listStoreInventory() { return inventory.map(item => ({ ...item })); },
    async upsertStoreInventory(rows) {
      for (const row of rows) {
        const existing = inventory.find(item => item.squareVariationId === row.squareVariationId);
        if (existing) Object.assign(existing, row);
        else inventory.push({ ...row });
      }
      return rows;
    },
    async adminDashboard() { return { arrivals: [] }; },
    async listFuelInventory() { return []; },
    async listFuelPrices() { return []; },
    async recordAuditLog(entry) { auditLog.push(entry); },
  };
}

function squareCatalogObject(itemId, variationId, name) {
  return { id: itemId, updated_at: '2026-07-16T12:00:00Z', item_data: { name, variations: [{ id: variationId, item_variation_data: { sku: variationId, price_money: { amount: 500, currency: 'USD' } } }] } };
}

function makePagedSquareFetch() {
  // Two catalog pages, then inventory counts of 4 for whatever ids are asked.
  const catalogCursors = [];
  const countBatches = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.includes('/v2/catalog/list')) {
      const cursor = new URL(url).searchParams.get('cursor');
      catalogCursors.push(cursor);
      if (!cursor) {
        return new Response(JSON.stringify({ objects: [squareCatalogObject('ITEM_A', 'VAR_A', 'Cold Brew')], cursor: 'PAGE-2' }), { status: 200 });
      }
      return new Response(JSON.stringify({ objects: [squareCatalogObject('ITEM_B', 'VAR_B', 'Trail Mix')] }), { status: 200 });
    }
    assert.match(url, /inventory\/counts\/batch-retrieve/);
    const ids = JSON.parse(options.body).catalog_object_ids;
    countBatches.push(ids);
    return new Response(JSON.stringify({ counts: ids.map(id => ({ catalog_object_id: id, location_id: 'MIDWAY', state: 'IN_STOCK', quantity: '4', calculated_at: '2026-07-16T12:01:00Z' })) }), { status: 200 });
  };
  return { fetchImpl, catalogCursors, countBatches };
}

test('square sync job steps through catalog pages and inventory counts with progress', async () => {
  const store = makeMergingStore();
  const { fetchImpl, catalogCursors, countBatches } = makePagedSquareFetch();
  const service = createCommandCenterService({
    store,
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl,
    now: () => new Date('2026-07-16T12:00:00Z'),
  });

  const started = await service.startSquareSyncJob({ actor: { email: 'owner@midway.test' } });
  assert.equal(started.status, 'running');
  assert.equal(started.phase, 'catalog');
  assert.equal(started.itemsDone, 0);
  assert.equal(started.itemsTotal, null);

  const progress = [];
  let job = started;
  for (let step = 0; step < 10 && job.status === 'running'; step += 1) {
    job = await service.stepSquareSyncJob(started.id);
    progress.push({ phase: job.phase, itemsDone: job.itemsDone });
  }

  assert.deepEqual(progress, [
    { phase: 'catalog', itemsDone: 1 },
    { phase: 'inventory', itemsDone: 2 },
    { phase: 'completed', itemsDone: 4 },
  ], 'progress must accumulate while phases advance catalog -> inventory -> completed');
  assert.equal(job.status, 'completed');
  assert.equal(job.itemsTotal, 4);
  assert.deepEqual(catalogCursors, [null, 'PAGE-2'], 'each catalog step must fetch exactly one page by cursor');
  assert.deepEqual(countBatches, [['VAR_A', 'VAR_B']], 'inventory counts must run as one bounded batch');

  const fetched = await service.getSquareSyncJob(started.id);
  assert.equal(fetched.status, 'completed');
  assert.equal(fetched.errorMessage, null);
  assert.deepEqual(
    store.auditLog.map(entry => entry.action),
    ['command_center.square_sync_job_start', 'command_center.square_sync'],
    'job start and completion must be audit logged like the one-shot sync',
  );

  // A step on a finished job is a no-op instead of re-syncing.
  const again = await service.stepSquareSyncJob(started.id);
  assert.equal(again.status, 'completed');
  assert.deepEqual(catalogCursors.length, 2);

  await assert.rejects(
    service.getSquareSyncJob('missing-job'),
    error => error.code === 'SQUARE_SYNC_JOB_NOT_FOUND',
  );

  // The stepped job must persist the same inventory as the old one-shot sync.
  const oneShotStore = makeMergingStore();
  const oneShotService = createCommandCenterService({
    store: oneShotStore,
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: makePagedSquareFetch().fetchImpl,
    now: () => new Date('2026-07-16T12:00:00Z'),
  });
  await oneShotService.syncSquare({ force: true });
  const pick = rows => rows.map(item => ({ id: item.squareVariationId, name: item.name, quantity: item.quantity, lastCountedAt: item.lastCountedAt }));
  assert.deepEqual(pick(await service.listInventory()), pick(await oneShotService.listInventory()));
});

test('square sync job refuses to start without Square and records step failures', async () => {
  const disconnected = createCommandCenterService({ store: makeMergingStore(), squareConfig: async () => ({}) });
  await assert.rejects(
    disconnected.startSquareSyncJob({}),
    error => error.code === 'SQUARE_INVENTORY_NOT_CONNECTED',
  );

  const service = createCommandCenterService({
    store: makeMergingStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: async () => new Response(JSON.stringify({ errors: [{ detail: 'Square is down' }] }), { status: 500 }),
    now: () => new Date('2026-07-16T12:00:00Z'),
  });
  const job = await service.startSquareSyncJob({});
  await assert.rejects(service.stepSquareSyncJob(job.id), /Square is down/);
  const failed = await service.getSquareSyncJob(job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorMessage, 'Square is down');
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

test('create_square_item assigns the next item number, creates the category, and sets stock', async () => {
  const upserts = [];
  let countedBody = null;
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith('/v2/catalog/search')) {
        return new Response(JSON.stringify({ objects: [] }), { status: 200 });
      }
      if (url.endsWith('/v2/catalog/object')) {
        const body = JSON.parse(options.body);
        upserts.push(body.object.type);
        if (body.object.type === 'CATEGORY') {
          return new Response(JSON.stringify({ catalog_object: { id: 'CAT_SNACKS', type: 'CATEGORY', category_data: { name: 'Snacks' } } }), { status: 200 });
        }
        assert.equal(body.object.item_data.categories[0].id, 'CAT_SNACKS');
        assert.equal(body.object.item_data.variations[0].item_variation_data.sku, '1001', 'no numeric SKUs exist yet, so the first assigned item number is 1001');
        return new Response(JSON.stringify({ catalog_object: {
          id: 'ITEM_NEW',
          updated_at: '2026-07-22T12:00:00Z',
          item_data: {
            name: body.object.item_data.name,
            categories: [{ id: 'CAT_SNACKS', name: 'Snacks' }],
            variations: [{ id: 'VAR_NEW', item_variation_data: { ...body.object.item_data.variations[0].item_variation_data } }],
          },
        } }), { status: 200 });
      }
      assert.match(url, /inventory\/changes\/batch-create/);
      countedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ counts: [] }), { status: 200 });
    },
    now: () => new Date('2026-07-22T12:00:00Z'),
  });

  const created = await service.createCatalogItem({
    name: 'Snickers King Size',
    priceCents: 299,
    upc: '040000424307',
    categoryName: 'Snacks',
    initialQuantity: 24,
    actor: { email: 'owner@midway.test' },
  });

  assert.equal(created.sku, '1001');
  assert.equal(created.squareItemId, 'ITEM_NEW');
  assert.equal(created.squareVariationId, 'VAR_NEW');
  assert.equal(created.quantity, 24);
  assert.deepEqual(upserts, ['CATEGORY', 'ITEM']);
  assert.equal(countedBody.changes[0].physical_count.catalog_object_id, 'VAR_NEW');
  assert.equal(countedBody.changes[0].physical_count.quantity, '24');

  const inventory = await service.listInventory({ search: 'Snickers' });
  assert.equal(inventory.length, 1, 'the new item must appear in local inventory immediately');
  assert.equal(inventory[0].quantity, 24);
});

test('set_square_item_stock records a physical count and updates the local balance', async () => {
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: async (url, options = {}) => {
      assert.match(url, /inventory\/changes\/batch-create/);
      const body = JSON.parse(options.body);
      assert.equal(body.changes[0].physical_count.quantity, '12');
      return new Response(JSON.stringify({ counts: [] }), { status: 200 });
    },
    now: () => new Date('2026-07-22T12:00:00Z'),
  });
  const result = await service.setItemStock({ squareVariationId: 'VAR_COFFEE', quantity: 12 });
  assert.equal(result.quantity, 12);
  const inventory = await service.listInventory({ search: 'Coffee' });
  assert.equal(inventory[0].quantity, 12);
});

test('square API pass-through guards paths and read-only mode', async () => {
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: async url => {
      assert.match(url, /\/v2\/payments\?limit=5$/);
      return new Response(JSON.stringify({ payments: [] }), { status: 200 });
    },
  });
  const data = await service.callSquareApi({ method: 'GET', path: '/v2/payments?limit=5', readOnly: true });
  assert.deepEqual(data.payments, []);
  await assert.rejects(service.callSquareApi({ method: 'POST', path: '/v2/customers', readOnly: true }), error => error.code === 'SQUARE_READ_ONLY');
  await assert.rejects(service.callSquareApi({ method: 'GET', path: 'https://evil.example/v2/x' }), error => error.code === 'SQUARE_PATH_INVALID');
  await assert.rejects(service.callSquareApi({ method: 'PATCH', path: '/v2/payments' }), error => error.code === 'SQUARE_METHOD_INVALID');
});

test('create_square_item updates an existing item instead of duplicating when the barcode matches', async () => {
  // The register already carries this item with the barcode in the SKU field.
  // The delivery presents the SAME barcode in the UPC field under a shorter name
  // — the exact shape that previously spawned duplicates.
  const existingItem = {
    id: 'ITEM_TAKIS', type: 'ITEM', updated_at: '2026-07-01T00:00:00Z',
    item_data: {
      name: 'Takis 3.25z Fuego 20 3.25z',
      variations: [{
        id: 'VAR_TAKIS', type: 'ITEM_VARIATION',
        item_variation_data: { item_id: 'ITEM_TAKIS', name: 'Regular', sku: '5840763', upc: '757528048075', price_money: { amount: 349, currency: 'USD' } },
      }],
    },
  };
  const variation = { id: 'VAR_TAKIS', type: 'ITEM_VARIATION', item_variation_data: { item_id: 'ITEM_TAKIS', name: 'Regular', sku: '5840763', upc: '757528048075' } };
  const posted = [];
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : {};
      if (url.includes('/v2/catalog/list')) return new Response(JSON.stringify({ objects: [existingItem] }), { status: 200 });
      if (url.includes('/v2/inventory/counts/batch-retrieve')) return new Response(JSON.stringify({ counts: [{ catalog_object_id: 'VAR_TAKIS', location_id: 'MIDWAY', state: 'IN_STOCK', quantity: '1' }] }), { status: 200 });
      if (url.includes('/v2/catalog/search')) return new Response(JSON.stringify({ objects: [variation] }), { status: 200 });
      if (url.includes('/v2/catalog/object/VAR_TAKIS')) return new Response(JSON.stringify({ object: variation, related_objects: [existingItem] }), { status: 200 });
      if (url.includes('/v2/catalog/object')) { posted.push(body.object); return new Response(JSON.stringify({ catalog_object: existingItem }), { status: 200 }); }
      if (url.includes('/v2/inventory/changes/batch-create')) return new Response(JSON.stringify({ counts: [] }), { status: 200 });
      throw new Error(`unexpected url ${url}`);
    },
  });

  const result = await service.createCatalogItem({ name: 'Takis Fuego', upc: '757528048075', priceCents: 389, initialQuantity: 20 });

  assert.equal(result.alreadyExisted, true, 'a matching barcode must not create a new item');
  assert.equal(result.matchedBy, 'barcode');
  assert.equal(result.squareItemId, 'ITEM_TAKIS');
  assert.ok(!posted.some(object => object?.id === '#new-item'), 'no brand-new item object should be posted to Square');
});

test('create_square_item still creates a genuinely new product', async () => {
  const posted = [];
  const service = createCommandCenterService({
    store: makeStore(),
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : {};
      if (url.includes('/v2/catalog/list')) return new Response(JSON.stringify({ objects: [] }), { status: 200 });
      if (url.includes('/v2/inventory/counts/batch-retrieve')) return new Response(JSON.stringify({ counts: [] }), { status: 200 });
      if (url.includes('/v2/inventory/changes/batch-create')) return new Response(JSON.stringify({ counts: [] }), { status: 200 });
      if (url.includes('/v2/catalog/search')) return new Response(JSON.stringify({ objects: [] }), { status: 200 });
      if (url.includes('/v2/catalog/object')) {
        posted.push(body.object);
        return new Response(JSON.stringify({ catalog_object: { id: 'ITEM_NEW', type: 'ITEM', item_data: { name: 'Zebra Gum', variations: [{ id: 'VAR_NEW', type: 'ITEM_VARIATION', item_variation_data: { sku: '1001', upc: '111122223333', price_money: { amount: 150, currency: 'USD' } } }] } } }), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    },
  });

  const result = await service.createCatalogItem({ name: 'Zebra Gum', upc: '111122223333', priceCents: 150 });

  assert.ok(!result.alreadyExisted, 'a brand-new product should be created, not deduped');
  assert.equal(result.squareItemId, 'ITEM_NEW');
  assert.ok(posted.some(object => object?.id === '#new-item'), 'a new item object must be posted to Square');
});

test('deleting a Square item scrubs the local mirror so no phantom row remains', async () => {
  const store = makeStore();
  const service = createCommandCenterService({
    store,
    squareConfig: async () => ({ accessToken: 'square-token', locationId: 'MIDWAY', environment: 'sandbox' }),
    fetchImpl: async (url, options = {}) => {
      if (options.method === 'DELETE' && url.includes('/v2/catalog/object/ITEM_COFFEE')) {
        return new Response(JSON.stringify({ deleted_object_ids: ['ITEM_COFFEE', 'VAR_COFFEE'] }), { status: 200 });
      }
      throw new Error(`unexpected ${options.method} ${url}`);
    },
  });
  // Give the item an on-hand balance so we can prove the count is cleared too.
  await service.updateInventoryRule({ squareVariationId: 'VAR_COFFEE', reorderPoint: 5 });
  assert.ok((await service.listInventory()).some(item => item.squareVariationId === 'VAR_COFFEE'));

  const result = await service.deleteCatalogItem({ squareItemId: 'ITEM_COFFEE' });

  assert.deepEqual(result.deletedObjectIds, ['ITEM_COFFEE', 'VAR_COFFEE']);
  const after = await service.listInventory();
  assert.ok(!after.some(item => item.squareVariationId === 'VAR_COFFEE'), 'the deleted item must not linger in the mirror');
});
