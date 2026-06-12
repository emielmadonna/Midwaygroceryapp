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

test('memory booking store blocks all sites in a multi-site hold', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });

  const hold = await store.createHold({
    siteIds: ['site-1', 'site-2'],
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    customerSessionId: 'browser-1',
  });
  const booking = await store.createPendingBooking({
    holdId: hold.id,
    customer: { name: 'Group Guest', phone: '555-0102' },
    bookingCode: 'MW-GROUP',
  });
  const available = await store.listAvailability({
    startDate: '2026-05-16',
    endDate: '2026-05-17',
  });

  assert.deepEqual(booking.siteIds, ['site-1', 'site-2']);
  assert.deepEqual(available.map(site => site.id), []);
});

test('memory booking store creates multi-site admin bookings', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });

  const booking = await store.createAdminBooking({
    siteIds: ['site-1', 'site-2'],
    startDate: '2026-05-19',
    endDate: '2026-05-21',
    guests: 4,
    vehicles: 2,
    customer: { name: 'Admin Group', phone: '555-0199' },
  });
  const available = await store.listAvailability({
    startDate: '2026-05-20',
    endDate: '2026-05-21',
  });

  assert.equal(booking.status, 'confirmed');
  assert.deepEqual(booking.siteIds, ['site-1', 'site-2']);
  assert.equal(booking.totalCents, 21400);
  assert.deepEqual(available.map(site => site.id), []);
});

test('memory booking store records driver license upload metadata', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });
  const hold = await store.createHold({
    siteId: 'site-1',
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    customerSessionId: 'browser-1',
  });
  await store.createPendingBooking({
    holdId: hold.id,
    customer: { name: 'Guest One', phone: '555-0100' },
    bookingCode: 'MW-DOCS',
  });

  const document = await store.recordDriverLicenseUpload({
    bookingCode: 'MW-DOCS',
    fileName: 'license.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1234,
  });
  const booking = await store.getBooking('MW-DOCS');

  assert.equal(document.documentType, 'driver_license');
  assert.equal(document.status, 'uploaded');
  assert.equal(booking.driverLicenseStatus, 'uploaded');
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

// ─── lookupBookings (admin search) ──────────────────────────────────────────

async function storeWithConfirmedBooking(fields = {}) {
  const store = createMemoryBookingStore({ sites, now: () => now });
  const booking = await store.createAdminBooking({
    siteId: 'site-1',
    startDate: '2026-05-19',
    endDate: '2026-05-21',
    customer: {
      name: 'Jane Doe',
      phone: '(555) 010-1234',
      email: 'jane@example.com',
      ...fields,
    },
  });
  return { store, booking };
}

test('lookupBookings finds booking by partial phone number', async () => {
  const { store, booking } = await storeWithConfirmedBooking();
  const results = await store.lookupBookings({ query: '010-1234' });
  assert.equal(results.length, 1);
  assert.equal(results[0].bookingCode, booking.bookingCode);
});

test('lookupBookings finds booking by email', async () => {
  const { store, booking } = await storeWithConfirmedBooking();
  const results = await store.lookupBookings({ query: 'jane@example.com' });
  assert.equal(results.length, 1);
  assert.equal(results[0].bookingCode, booking.bookingCode);
});

test('lookupBookings finds booking by partial name', async () => {
  const { store, booking } = await storeWithConfirmedBooking();
  const results = await store.lookupBookings({ query: 'jane' });
  assert.equal(results.length, 1);
  assert.equal(results[0].bookingCode, booking.bookingCode);
});

test('lookupBookings returns empty array for no match', async () => {
  const { store } = await storeWithConfirmedBooking();
  const results = await store.lookupBookings({ query: 'nobody@nowhere.com' });
  assert.equal(results.length, 0);
});

// ─── lookupPublicBookings (self-service auth) ────────────────────────────────

test('lookupPublicBookings returns bookings when phone and email match', async () => {
  const { store, booking } = await storeWithConfirmedBooking();
  const results = await store.lookupPublicBookings({ phone: '(555) 010-1234', email: 'jane@example.com' });
  assert.equal(results.length, 1);
  assert.equal(results[0].bookingCode, booking.bookingCode);
});

test('lookupPublicBookings normalises phone digits before matching', async () => {
  const { store, booking } = await storeWithConfirmedBooking();
  const results = await store.lookupPublicBookings({ phone: '5550101234', email: 'jane@example.com' });
  assert.equal(results.length, 1);
  assert.equal(results[0].bookingCode, booking.bookingCode);
});

test('lookupPublicBookings returns empty when email does not match', async () => {
  const { store } = await storeWithConfirmedBooking();
  const results = await store.lookupPublicBookings({ phone: '(555) 010-1234', email: 'wrong@example.com' });
  assert.equal(results.length, 0);
});

test('lookupPublicBookings returns empty when phone does not match', async () => {
  const { store } = await storeWithConfirmedBooking();
  const results = await store.lookupPublicBookings({ phone: '(555) 999-0000', email: 'jane@example.com' });
  assert.equal(results.length, 0);
});

// ─── updateBookingDetails ────────────────────────────────────────────────────

test('updateBookingDetails changes dates and recalculates price', async () => {
  const { store, booking } = await storeWithConfirmedBooking();
  const result = await store.updateBookingDetails({
    bookingCode: booking.bookingCode,
    patch: { startDate: '2026-05-19', endDate: '2026-05-23' },
  });
  assert.equal(result.booking.nights, 4);
  assert.equal(result.booking.startDate, '2026-05-19');
  assert.equal(result.booking.endDate, '2026-05-23');
  assert.equal(result.booking.totalCents, 4400 * 4);
  assert.equal(result.diffCents, (4400 * 4) - booking.totalCents);
});

test('updateBookingDetails changes vehicle count and recalculates fee', async () => {
  const { store, booking } = await storeWithConfirmedBooking();
  const result = await store.updateBookingDetails({
    bookingCode: booking.bookingCode,
    patch: { vehicles: 3 },
  });
  assert.equal(result.booking.vehicles, 3);
  assert.equal(result.booking.feeCents, 2000);
  assert.equal(result.diffCents, 2000);
});

test('updateBookingDetails allows booking to move onto its own current dates', async () => {
  const { store, booking } = await storeWithConfirmedBooking();
  const result = await store.updateBookingDetails({
    bookingCode: booking.bookingCode,
    patch: { endDate: '2026-05-22' },
  });
  assert.equal(result.booking.endDate, '2026-05-22');
  assert.equal(result.booking.nights, 3);
});

test('updateBookingDetails rejects new dates that conflict with another confirmed booking', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });
  await store.createAdminBooking({
    siteId: 'site-1',
    startDate: '2026-05-22',
    endDate: '2026-05-25',
    customer: { name: 'Other Guest', phone: '555-0200' },
  });
  const booking = await store.createAdminBooking({
    siteId: 'site-1',
    startDate: '2026-05-19',
    endDate: '2026-05-21',
    customer: { name: 'Edit Guest', phone: '555-0201' },
  });

  await assert.rejects(
    () => store.updateBookingDetails({
      bookingCode: booking.bookingCode,
      patch: { endDate: '2026-05-24' },
    }),
    /not available/,
  );
});

test('updateBookingDetails returns null for unknown booking code', async () => {
  const store = createMemoryBookingStore({ sites, now: () => now });
  const result = await store.updateBookingDetails({
    bookingCode: 'MW-NOPE99',
    patch: { vehicles: 2 },
  });
  assert.equal(result, null);
});
