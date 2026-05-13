import crypto from 'node:crypto';

const CONFIRMED_STATUSES = new Set(['hold', 'paid', 'confirmed', 'blocked']);

export function nightsBetween(startDate, endDate) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const nights = Math.round((end - start) / 86400000);
  if (!Number.isFinite(nights) || nights < 1) {
    throw new Error('Departure date must be after arrival date.');
  }
  return nights;
}

export function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export function isActiveHold(hold, now = new Date()) {
  return hold?.status === 'active' && new Date(hold.expiresAt) > now;
}

export function getAvailableSites({
  sites = [],
  bookings = [],
  holds = [],
  startDate,
  endDate,
  now = new Date(),
}) {
  nightsBetween(startDate, endDate);

  const blockedSiteIds = new Set();

  for (const booking of bookings) {
    if (!CONFIRMED_STATUSES.has(booking.status)) continue;
    if (rangesOverlap(startDate, endDate, booking.startDate, booking.endDate)) {
      blockedSiteIds.add(booking.rvSiteId);
    }
  }

  for (const hold of holds) {
    if (!isActiveHold(hold, now)) continue;
    if (rangesOverlap(startDate, endDate, hold.startDate, hold.endDate)) {
      blockedSiteIds.add(hold.rvSiteId);
    }
  }

  return sites
    .filter(site => site.status === 'active')
    .filter(site => !blockedSiteIds.has(site.id));
}

export function quoteBooking({ site, startDate, endDate, guests = 1, vehicles = 1 }) {
  if (!site) throw new Error('RV site is required.');

  const nights = nightsBetween(startDate, endDate);
  const nightlyPriceCents = Number(site.nightlyPriceCents ?? site.nightly_price_cents ?? 0);
  if (!Number.isInteger(nightlyPriceCents) || nightlyPriceCents < 0) {
    throw new Error('RV site price is invalid.');
  }

  const subtotalCents = nightlyPriceCents * nights;
  const taxCents = 0;
  const feeCents = 0;

  return {
    siteId: site.id,
    siteNumber: site.siteNumber,
    startDate,
    endDate,
    nights,
    guests,
    vehicles,
    nightlyPriceCents,
    squareCatalogObjectId: site.squareCatalogObjectId ?? site.square_catalog_object_id ?? null,
    sku: site.sku ?? null,
    subtotalCents,
    taxCents,
    feeCents,
    totalCents: subtotalCents + taxCents + feeCents,
    currency: 'USD',
  };
}

export function createBookingHold({
  sites = [],
  bookings = [],
  holds = [],
  siteId,
  startDate,
  endDate,
  customerSessionId,
  now = new Date(),
  ttlMinutes = 15,
  guests = 1,
  vehicles = 1,
}) {
  if (!customerSessionId) throw new Error('Customer session is required.');

  const site = sites.find(candidate => candidate.id === siteId);
  if (!site || site.status !== 'active') {
    throw new Error('That RV site is not available.');
  }

  const available = getAvailableSites({ sites, bookings, holds, startDate, endDate, now });
  if (!available.some(candidate => candidate.id === siteId)) {
    throw new Error('That RV site is no longer available for the selected dates.');
  }

  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();

  return {
    id: crypto.randomUUID(),
    rvSiteId: siteId,
    startDate,
    endDate,
    customerSessionId,
    expiresAt,
    status: 'active',
    quote: quoteBooking({ site, startDate, endDate, guests, vehicles }),
    createdAt: now.toISOString(),
  };
}

export function toPublicSite(site) {
  return {
    id: site.id,
    siteNumber: site.siteNumber,
    displayName: site.displayName,
    status: site.status,
    nightlyPriceCents: site.nightlyPriceCents,
    maxRvLengthFeet: site.maxRvLengthFeet,
    mapX: site.mapX,
    mapY: site.mapY,
    mapWidth: site.mapWidth,
    mapHeight: site.mapHeight,
    rotation: site.rotation ?? 0,
    amp: site.amp,
    type: site.type,
    shade: site.shade,
    sku: site.sku ?? '',
    amenities: site.amenities ?? [],
    customerNotes: site.customerNotes ?? '',
  };
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
    throw new Error('Dates must use YYYY-MM-DD format.');
  }
  return new Date(`${value}T00:00:00.000Z`);
}
