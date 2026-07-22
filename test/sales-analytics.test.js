import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSalesAnalytics, normalizeSquareOrders } from '../src/lib/sales-analytics.js';

test('Square order normalization uses local business date and subtracts item returns', () => {
  const { orders, lines } = normalizeSquareOrders([{
    id: 'ORDER-1', location_id: 'MIDWAY', state: 'COMPLETED', closed_at: '2026-07-17T06:30:00Z', updated_at: '2026-07-17T06:31:00Z',
    total_money: { amount: 1080, currency: 'USD' }, total_tax_money: { amount: 80, currency: 'USD' },
    line_items: [{ uid: 'LINE-1', catalog_object_id: 'VAR-COFFEE', name: 'Coffee', variation_name: 'Large', quantity: '2', gross_sales_money: { amount: 1000 }, total_discount_money: { amount: 0 }, total_tax_money: { amount: 80 }, total_money: { amount: 1080, currency: 'USD' } }],
    returns: [{ return_line_items: [{ source_line_item_uid: 'LINE-1', quantity: '1', total_tax_money: { amount: 40 }, total_money: { amount: 540 } }] }],
  }], { timezone: 'America/Los_Angeles', ingestedAt: '2026-07-17T07:00:00Z' });

  assert.equal(orders[0].businessDate, '2026-07-16', 'late UTC sales must remain on the Midway local business day');
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].returnedQuantity, 1);
  assert.equal(lines[0].netQuantity, 1);
  assert.equal(lines[0].netSalesCents, 500);
});

test('sales analytics ranks items, compares periods, and refuses premature forecasts', () => {
  const lines = [];
  for (let day = 1; day <= 40; day += 1) {
    const date = new Date(Date.UTC(2026, 5, day)).toISOString().slice(0, 10);
    lines.push({ id: `coffee-${day}`, orderId: `order-${day}`, businessDate: date, squareVariationId: 'COFFEE', itemName: 'Coffee', quantity: 2, returnedQuantity: 0, netQuantity: 2, netSalesCents: 600, returnedNetCents: 0 });
    lines.push({ id: `ice-${day}`, orderId: `order-${day}`, businessDate: date, squareVariationId: 'ICE', itemName: 'Ice', quantity: 1, returnedQuantity: 0, netQuantity: 1, netSalesCents: 450, returnedNetCents: 0 });
  }
  const analytics = buildSalesAnalytics({
    lines,
    days: 30,
    now: new Date('2026-07-10T12:00:00Z'),
    lastSync: { status: 'completed', completedAt: '2026-07-10T11:00:00Z' },
    catalog: [{ squareVariationId: 'COFFEE', sku: 'COF', category: 'Drinks' }, { squareVariationId: 'ICE', sku: 'ICE', category: 'Convenience' }],
  });

  assert.equal(analytics.topItems[0].name, 'Coffee');
  assert.equal(analytics.topItems[0].catalogMatched, true);
  assert.equal(analytics.daily.length, 30);
  assert.equal(analytics.quality.catalogCoveragePercent, 100);
  assert.equal(analytics.forecast.ready, false);
  assert.match(analytics.forecast.note, /more days/);
});

test('sales analytics only marks forecasts ready with sufficient clean, fresh history', () => {
  const lines = [];
  for (let day = 0; day < 100; day += 1) {
    const date = new Date(Date.UTC(2026, 3, 1 + day)).toISOString().slice(0, 10);
    lines.push({ id: `line-${day}`, orderId: `order-${day}`, businessDate: date, squareVariationId: 'COFFEE', itemName: 'Coffee', quantity: 2, returnedQuantity: 0, netQuantity: 2, netSalesCents: 600, returnedNetCents: 0 });
  }
  const inventorySnapshots = lines.slice(0, 90).map(line => ({ squareVariationId: 'COFFEE', snapshotDate: line.businessDate, quantity: 10 }));
  const analytics = buildSalesAnalytics({ lines, days: 30, now: new Date('2026-07-09T12:00:00Z'), lastSync: { completedAt: '2026-07-09T10:00:00Z' }, catalog: [{ squareVariationId: 'COFFEE' }], inventorySnapshots });
  assert.equal(analytics.quality.status, 'strong');
  assert.equal(analytics.forecast.ready, true);
  assert.equal(analytics.forecast.daily.length, 7);
  assert.equal(analytics.forecast.totalExpectedUnits, 14);
});

test('data quality counts real catalog matches instead of merely present Square IDs', () => {
  const analytics = buildSalesAnalytics({
    lines: [
      { id: 'matched', orderId: 'one', businessDate: '2026-07-16', squareVariationId: 'COFFEE', itemName: 'Coffee', netQuantity: 1, netSalesCents: 300 },
      { id: 'stale', orderId: 'two', businessDate: '2026-07-16', squareVariationId: 'OLD-ICE', itemName: 'Ice', netQuantity: 1, netSalesCents: 450 },
    ],
    days: 30,
    now: new Date('2026-07-17T12:00:00Z'),
    lastSync: { completedAt: '2026-07-17T11:00:00Z' },
    catalog: [{ squareVariationId: 'COFFEE' }],
  });

  assert.equal(analytics.quality.catalogCoveragePercent, 50);
  assert.match(analytics.quality.warnings[0], /50% of sales lines/);
});
