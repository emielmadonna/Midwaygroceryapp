import test from 'node:test';
import assert from 'node:assert/strict';

import { createQuickBooksDailySales } from '../src/lib/quickbooks-daily-sales.js';

function makeQuickBooksService({ connected = true, existingReceipts = [] } = {}) {
  const calls = [];
  return {
    calls,
    async getStatus() {
      return connected ? { connected: true, realmId: '9130350', companyName: 'Midway Store' } : { connected: false };
    },
    async request(options) {
      calls.push(options);
      if (options.method === 'GET' && options.path === '/query') {
        return { QueryResponse: { SalesReceipt: existingReceipts } };
      }
      if (options.method === 'POST' && options.path === '/salesreceipt') {
        return { SalesReceipt: { Id: '201', ...options.body } };
      }
      throw new Error(`Unexpected QuickBooks request: ${options.method} ${options.path}`);
    },
  };
}

function makeCommandCenter(totals) {
  const requestedDates = [];
  return {
    requestedDates,
    async getDailySalesTotals({ businessDate }) {
      requestedDates.push(businessDate);
      return { businessDate, ...totals };
    },
  };
}

test('daily sales cron stays quiet until QuickBooks is connected', async () => {
  const quickbooksService = makeQuickBooksService({ connected: false });
  const commandCenter = makeCommandCenter({ orders: 4, grossCents: 10000, taxCents: 700, refundCents: 0, netCents: 10000 });
  const dailySales = createQuickBooksDailySales({ quickbooksService, commandCenter, env: {} });

  const result = await dailySales.postDailySales({ businessDate: '2026-07-21' });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'quickbooks_not_connected');
  assert.equal(result.businessDate, '2026-07-21');
  assert.equal(quickbooksService.calls.length, 0, 'must not call QuickBooks at all when not connected');
});

test('a day with no Square orders is skipped without touching QuickBooks', async () => {
  const quickbooksService = makeQuickBooksService();
  const commandCenter = makeCommandCenter({ orders: 0, grossCents: 0, taxCents: 0, refundCents: 0, netCents: 0 });
  const dailySales = createQuickBooksDailySales({ quickbooksService, commandCenter, env: {} });

  const result = await dailySales.postDailySales({ businessDate: '2026-07-21' });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no_sales');
  assert.equal(quickbooksService.calls.length, 0, 'no receipt query or create should happen for an empty day');
});

test('happy path posts one receipt with net and tax lines in dollars', async () => {
  const quickbooksService = makeQuickBooksService();
  // Net of refunds is 13045 cents including 700 cents of tax → 123.45 net sales.
  const commandCenter = makeCommandCenter({ orders: 6, grossCents: 13345, taxCents: 700, refundCents: 300, netCents: 13045 });
  const dailySales = createQuickBooksDailySales({ quickbooksService, commandCenter, env: {} });

  const result = await dailySales.postDailySales({ businessDate: '2026-07-21' });

  assert.equal(result.status, 'posted');
  assert.equal(result.businessDate, '2026-07-21');
  assert.equal(result.netCents, 12345);
  assert.equal(result.taxCents, 700);
  assert.equal(result.receiptId, '201');
  assert.deepEqual(commandCenter.requestedDates, ['2026-07-21']);

  const [query, create] = quickbooksService.calls;
  assert.equal(query.method, 'GET');
  assert.equal(query.path, '/query');
  assert.match(query.query.query, /SalesReceipt where TxnDate = '2026-07-21'/);

  assert.equal(create.method, 'POST');
  assert.equal(create.path, '/salesreceipt');
  assert.equal(create.body.TxnDate, '2026-07-21');
  assert.equal(create.body.Line.length, 2);
  assert.equal(create.body.Line[0].Amount, 123.45);
  assert.equal(create.body.Line[0].Description, 'Daily store sales (net)');
  assert.equal(create.body.Line[0].DetailType, 'SalesItemLineDetail');
  assert.equal(create.body.Line[0].SalesItemLineDetail.ItemRef.value, '1');
  assert.equal(create.body.Line[1].Amount, 7);
  assert.equal(create.body.Line[1].Description, 'Sales tax collected');
  assert.ok(create.body.PrivateNote.includes('midway-daily-sales:2026-07-21'), 'PrivateNote must carry the idempotency marker');
});

test('tax line is omitted when no tax was collected', async () => {
  const quickbooksService = makeQuickBooksService();
  const commandCenter = makeCommandCenter({ orders: 2, grossCents: 5000, taxCents: 0, refundCents: 0, netCents: 5000 });
  const dailySales = createQuickBooksDailySales({ quickbooksService, commandCenter, env: {} });

  const result = await dailySales.postDailySales({ businessDate: '2026-07-21' });

  assert.equal(result.status, 'posted');
  const create = quickbooksService.calls.at(-1);
  assert.equal(create.body.Line.length, 1);
  assert.equal(create.body.Line[0].Amount, 50);
});

test('a receipt already carrying the marker blocks a second post', async () => {
  const quickbooksService = makeQuickBooksService({
    existingReceipts: [
      { Id: '77', PrivateNote: 'some unrelated receipt' },
      { Id: '88', PrivateNote: 'midway-daily-sales:2026-07-21 · posted automatically from Square by Midway' },
    ],
  });
  const commandCenter = makeCommandCenter({ orders: 6, grossCents: 13345, taxCents: 700, refundCents: 300, netCents: 13045 });
  const dailySales = createQuickBooksDailySales({ quickbooksService, commandCenter, env: {} });

  const result = await dailySales.postDailySales({ businessDate: '2026-07-21' });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'already_posted');
  assert.equal(result.receiptId, '88');
  assert.equal(quickbooksService.calls.length, 1, 'only the idempotency query may run');
  assert.equal(quickbooksService.calls[0].method, 'GET');
});

test('default business date is yesterday in Pacific time', async () => {
  const quickbooksService = makeQuickBooksService({ connected: false });
  const commandCenter = makeCommandCenter({ orders: 0, grossCents: 0, taxCents: 0, refundCents: 0, netCents: 0 });
  // 2026-07-22T03:00:00Z is still 2026-07-21 in Los Angeles, so "yesterday" is 2026-07-20.
  const dailySales = createQuickBooksDailySales({
    quickbooksService,
    commandCenter,
    env: {},
    now: () => new Date('2026-07-22T03:00:00Z'),
  });

  const result = await dailySales.postDailySales();

  assert.equal(result.businessDate, '2026-07-20');
});
