import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBookingHold,
  getAvailableSites,
  quoteBooking,
  quoteMultiSiteBooking,
} from '../src/lib/rv-booking.js';

const now = new Date('2026-05-12T12:00:00.000Z');
const sites = [
  { id: 'site-1', siteNumber: '01', status: 'active', nightlyPriceCents: 4400 },
  { id: 'site-2', siteNumber: '02', status: 'active', nightlyPriceCents: 5800 },
];

test('available sites exclude confirmed bookings and active holds for overlapping nights', () => {
  const available = getAvailableSites({
    sites,
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    now,
    bookings: [
      {
        id: 'booking-1',
        rvSiteId: 'site-1',
        startDate: '2026-05-16',
        endDate: '2026-05-19',
        status: 'confirmed',
      },
    ],
    holds: [
      {
        id: 'hold-1',
        rvSiteId: 'site-2',
        startDate: '2026-05-14',
        endDate: '2026-05-16',
        expiresAt: '2026-05-12T12:10:00.000Z',
        status: 'active',
      },
    ],
  });

  assert.deepEqual(available.map(site => site.id), []);
});

test('expired holds do not block availability', () => {
  const available = getAvailableSites({
    sites,
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    now,
    holds: [
      {
        id: 'hold-1',
        rvSiteId: 'site-1',
        startDate: '2026-05-15',
        endDate: '2026-05-18',
        expiresAt: '2026-05-12T11:59:59.000Z',
        status: 'active',
      },
    ],
  });

  assert.deepEqual(available.map(site => site.id), ['site-1', 'site-2']);
});

test('quoteBooking calculates nights and total on the server', () => {
  const quote = quoteBooking({
    site: sites[1],
    startDate: '2026-05-15',
    endDate: '2026-05-18',
  });

  assert.equal(quote.nights, 3);
  assert.equal(quote.subtotalCents, 17400);
  assert.equal(quote.totalCents, 17400);
  assert.equal(quote.currency, 'USD');
});

test('quoteBooking adds the extra vehicle fee after the first car', () => {
  const quote = quoteBooking({
    site: sites[0],
    startDate: '2026-05-15',
    endDate: '2026-05-17',
    vehicles: 3,
  });

  assert.equal(quote.vehicles, 3);
  assert.equal(quote.subtotalCents, 8800);
  assert.equal(quote.extraVehicleFeeCents, 2000);
  assert.equal(quote.feeCents, 2000);
  assert.equal(quote.totalCents, 10800);
});

test('quoteMultiSiteBooking totals multiple sites with one extra vehicle fee', () => {
  const quote = quoteMultiSiteBooking({
    sites,
    siteIds: ['site-1', 'site-2'],
    startDate: '2026-05-15',
    endDate: '2026-05-17',
    vehicles: 2,
  });

  assert.deepEqual(quote.siteIds, ['site-1', 'site-2']);
  assert.equal(quote.nights, 2);
  assert.equal(quote.subtotalCents, 20400);
  assert.equal(quote.extraVehicleFeeCents, 1000);
  assert.equal(quote.totalCents, 21400);
});

test('createBookingHold rejects a double-booked site', () => {
  assert.throws(
    () => createBookingHold({
      sites,
      bookings: [
        {
          id: 'booking-1',
          rvSiteId: 'site-1',
          startDate: '2026-05-15',
          endDate: '2026-05-18',
          status: 'paid',
        },
      ],
      siteId: 'site-1',
      startDate: '2026-05-16',
      endDate: '2026-05-17',
      customerSessionId: 'browser-1',
      now,
    }),
    /no longer available/,
  );
});

test('createBookingHold creates a short-lived hold with a server quote', () => {
  const hold = createBookingHold({
    sites,
    siteId: 'site-2',
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    customerSessionId: 'browser-1',
    now,
    ttlMinutes: 12,
  });

  assert.equal(hold.status, 'active');
  assert.equal(hold.rvSiteId, 'site-2');
  assert.equal(hold.quote.totalCents, 17400);
  assert.equal(hold.expiresAt, '2026-05-12T12:12:00.000Z');
});

test('createBookingHold can hold multiple available sites together', () => {
  const hold = createBookingHold({
    sites,
    siteIds: ['site-1', 'site-2'],
    startDate: '2026-05-15',
    endDate: '2026-05-18',
    customerSessionId: 'browser-1',
    now,
  });

  assert.deepEqual(hold.siteIds, ['site-1', 'site-2']);
  assert.equal(hold.rvSiteId, 'site-1');
  assert.equal(hold.quote.sites.length, 2);
  assert.equal(hold.quote.totalCents, 30600);
});
