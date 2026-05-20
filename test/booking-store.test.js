import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryBookingStore } from '../src/lib/booking-store.js';

const now = new Date('2026-05-12T12:00:00.000Z');
const sites = [
  { id: 'site-1', siteNumber: '01', status: 'active', nightlyPriceCents: 4400, sortOrder: 1 },
  { id: 'site-2', siteNumber: '02', status: 'active', nightlyPriceCents: 5800, sortOrder: 2 },
];

test('memory booking store prevents overlapping holds for the same site', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });

  await store.createHold({
    siteId: 'site-1',
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    customerSessionId: 'browser-1',
  });

  await assert.rejects(
    () => store.createHold({
      siteId: 'site-1',
      startDate: '2026-05-16',
      endDate: '2026-05-17',
      customerSessionId: 'browser-2',
    }),
    /no longer available/,
  );
});

test('memory booking store availability excludes active holds', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });

  await store.createHold({
    siteId: 'site-1',
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    customerSessionId: 'browser-1',
  });

  const available = await store.listAvailability({
    startDate: '2026-05-15',
    endDate: '2026-05-18',
  });

  assert.deepEqual(available.map(site => site.id), ['site-2']);
});

test('memory booking store releases holds back into availability', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });
  const hold = await store.createHold({
    siteId: 'site-1',
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    customerSessionId: 'browser-1',
  });

  await store.releaseHold({ holdId: hold.id, customerSessionId: 'browser-1' });
  const available = await store.listAvailability({
    startDate: '2026-05-15',
    endDate: '2026-05-18',
  });

  assert.deepEqual(available.map(site => site.id), ['site-1', 'site-2']);
});

test('memory booking store expires abandoned pending bookings', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });
  const hold = await store.createHold({
    siteId: 'site-1',
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    customerSessionId: 'browser-1',
    ttlMinutes: 1,
  });
  const booking = await store.createPendingBooking({
    holdId: hold.id,
    customer: { name: 'Guest One', phone: '555-0100' },
    bookingCode: 'MW-TEST1',
  });

  assert.equal(booking.status, 'hold');

  const expired = await store.expireHolds({ now: '2026-05-12T12:02:00.000Z' });
  const available = await store.listAvailability({
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    now: '2026-05-12T12:02:00.000Z',
  });

  assert.equal(expired.bookings[0].id, booking.id);
  assert.deepEqual(available.map(site => site.id), ['site-1', 'site-2']);
});

test('memory booking store records Square webhook events idempotently', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });
  const first = await store.recordSquareEvent({
    event: {
      eventId: 'evt-1',
      type: 'payment.updated',
      bookingCode: 'MW-TEST1',
      squareOrderId: 'order-1',
      squarePaymentId: 'payment-1',
    },
    payload: { type: 'payment.updated' },
  });

  assert.equal(first.duplicate, false);
  assert.equal(first.event.processingStatus, 'received');

  const marked = await store.markSquareEvent({
    eventId: 'evt-1',
    status: 'processed',
    booking: {
      bookingCode: 'MW-TEST1',
      squareOrderId: 'order-1',
      squarePaymentId: 'payment-1',
    },
  });
  assert.equal(marked.processingStatus, 'processed');
  assert.equal(marked.processedAt, now.toISOString());

  const duplicate = await store.recordSquareEvent({
    event: {
      eventId: 'evt-1',
      type: 'payment.updated',
    },
    payload: { type: 'payment.updated' },
  });

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.event.processingStatus, 'processed');
  assert.equal(duplicate.event.bookingCode, 'MW-TEST1');
});

test('memory booking store updates RV site details and amenities', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });
  const updated = await store.updateSiteDetails({
    siteId: 'site-1',
    patch: {
      displayName: 'Creekside 01',
      status: 'maintenance',
      nightlyPriceCents: 5200,
      maxRvLengthFeet: 34,
      amp: '30A',
      type: 'back',
      shade: 'partial',
      sku: 'RV-CREEK-01',
      squareCatalogObjectId: 'VAR_RV_01',
      customerNotes: 'Near the trees.',
      adminNotes: 'Check pedestal.',
      amenities: ['Water', 'Septic', 'Water'],
      mapX: 100,
      mapY: 200,
      mapWidth: 80,
      mapHeight: 40,
      rotation: -2,
    },
    actor: { id: 'owner-1' },
  });

  assert.equal(updated.displayName, 'Creekside 01');
  assert.equal(updated.status, 'maintenance');
  assert.equal(updated.nightlyPriceCents, 5200);
  assert.equal(updated.squareCatalogObjectId, 'VAR_RV_01');
  assert.deepEqual(updated.amenities, ['Water', 'Septic']);
  assert.equal(updated.updatedBy, 'owner-1');
});

test('memory booking store upserts Square catalog inventory by variation id', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });
  await store.upsertStoreInventory([
    {
      squareItemId: 'ITEM_1',
      squareVariationId: 'VAR_1',
      sku: 'FIREWOOD',
      name: 'Firewood Bundle',
      priceCents: 800,
      category: 'Camping',
      active: true,
      hidden: false,
    },
  ]);
  const updated = await store.upsertStoreInventory([
    {
      squareItemId: 'ITEM_1',
      squareVariationId: 'VAR_1',
      sku: 'FIREWOOD',
      name: 'Firewood Bundle',
      priceCents: 900,
      category: 'Camping',
      active: true,
      hidden: false,
    },
  ]);

  assert.equal(updated.length, 1);
  assert.equal(updated[0].priceCents, 900);
  assert.equal((await store.listStoreInventory()).length, 1);
  assert.equal((await store.findStoreInventoryByVariationId('VAR_1')).name, 'Firewood Bundle');
});
