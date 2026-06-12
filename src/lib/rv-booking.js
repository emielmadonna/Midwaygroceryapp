import crypto from 'node:crypto';

const CONFIRMED_STATUSES = new Set(['hold', 'paid', 'confirmed', 'blocked']);
const EXTRA_VEHICLE_FEE_CENTS = 1000;

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
  excludeBookingCode = null,
}) {
  nightsBetween(startDate, endDate);

  const blockedSiteIds = new Set();

  for (const booking of bookings) {
    if (excludeBookingCode && booking.bookingCode === excludeBookingCode) continue;
    if (!CONFIRMED_STATUSES.has(booking.status)) continue;
    if (rangesOverlap(startDate, endDate, booking.startDate, booking.endDate)) {
      for (const siteId of siteIdsForStay(booking)) blockedSiteIds.add(siteId);
    }
  }

  for (const hold of holds) {
    if (!isActiveHold(hold, now)) continue;
    if (rangesOverlap(startDate, endDate, hold.startDate, hold.endDate)) {
      for (const siteId of siteIdsForStay(hold)) blockedSiteIds.add(siteId);
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
  const vehicleCount = Math.max(1, Math.trunc(Number(vehicles) || 1));
  const extraVehicleFeeCents = Math.max(0, vehicleCount - 1) * EXTRA_VEHICLE_FEE_CENTS;
  const taxCents = 0;
  const feeCents = extraVehicleFeeCents;

  return {
    siteId: site.id,
    siteNumber: site.siteNumber,
    startDate,
    endDate,
    nights,
    guests,
    vehicles: vehicleCount,
    nightlyPriceCents,
    extraVehicleFeeCents,
    squareCatalogObjectId: site.squareCatalogObjectId ?? site.square_catalog_object_id ?? null,
    sku: site.sku ?? null,
    subtotalCents,
    taxCents,
    feeCents,
    totalCents: subtotalCents + taxCents + feeCents,
    currency: 'USD',
  };
}

export function quoteMultiSiteBooking({ sites = [], siteIds = [], startDate, endDate, guests = 1, vehicles = 1 }) {
  const selectedIds = normalizeSiteIds(siteIds);
  if (selectedIds.length === 0) throw new Error('At least one RV site is required.');

  const nights = nightsBetween(startDate, endDate);
  const selectedSites = selectedIds.map(siteId => {
    const site = sites.find(candidate => candidate.id === siteId);
    if (!site) throw new Error(`RV site ${siteId} was not found.`);
    if (site.status !== 'active') throw new Error(`RV site ${site.siteNumber || site.id} is not available.`);
    return site;
  });

  const lines = selectedSites.map(site => {
    const nightlyPriceCents = Number(site.nightlyPriceCents ?? site.nightly_price_cents ?? 0);
    if (!Number.isInteger(nightlyPriceCents) || nightlyPriceCents < 0) {
      throw new Error(`RV site ${site.siteNumber || site.id} price is invalid.`);
    }
    return {
      siteId: site.id,
      siteNumber: site.siteNumber,
      displayName: site.displayName,
      nightlyPriceCents,
      nights,
      subtotalCents: nightlyPriceCents * nights,
      squareCatalogObjectId: site.squareCatalogObjectId ?? site.square_catalog_object_id ?? null,
      sku: site.sku ?? null,
    };
  });

  const subtotalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const vehicleCount = Math.max(1, Math.trunc(Number(vehicles) || 1));
  const extraVehicleFeeCents = Math.max(0, vehicleCount - 1) * EXTRA_VEHICLE_FEE_CENTS;
  const taxCents = 0;
  const feeCents = extraVehicleFeeCents;

  return {
    siteId: lines[0].siteId,
    siteIds: lines.map(line => line.siteId),
    siteNumber: lines[0].siteNumber,
    siteNumbers: lines.map(line => line.siteNumber),
    sites: lines,
    startDate,
    endDate,
    nights,
    guests,
    vehicles: vehicleCount,
    nightlyPriceCents: lines[0].nightlyPriceCents,
    extraVehicleFeeCents,
    squareCatalogObjectId: lines.length === 1 ? lines[0].squareCatalogObjectId : null,
    sku: lines.length === 1 ? lines[0].sku : null,
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
  siteIds,
  startDate,
  endDate,
  customerSessionId,
  now = new Date(),
  ttlMinutes = 15,
  guests = 1,
  vehicles = 1,
}) {
  if (!customerSessionId) throw new Error('Customer session is required.');

  const selectedSiteIds = normalizeSiteIds(siteIds ?? siteId);
  if (selectedSiteIds.length === 0) throw new Error('At least one RV site is required.');

  const site = sites.find(candidate => candidate.id === selectedSiteIds[0]);
  if (!site || site.status !== 'active') {
    throw new Error('That RV site is not available.');
  }

  const available = getAvailableSites({ sites, bookings, holds, startDate, endDate, now });
  const availableSiteIds = new Set(available.map(candidate => candidate.id));
  if (!selectedSiteIds.every(id => availableSiteIds.has(id))) {
    throw new Error('That RV site is no longer available for the selected dates.');
  }

  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
  const quote = quoteMultiSiteBooking({
    sites,
    siteIds: selectedSiteIds,
    startDate,
    endDate,
    guests,
    vehicles,
  });

  return {
    id: crypto.randomUUID(),
    rvSiteId: selectedSiteIds[0],
    rvSiteIds: selectedSiteIds,
    siteIds: selectedSiteIds,
    startDate,
    endDate,
    customerSessionId,
    expiresAt,
    status: 'active',
    quote,
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
    hookup: site.hookup ?? '',
    type: site.type,
    shade: site.shade,
    sku: site.sku ?? '',
    amenities: site.amenities ?? [],
    customerNotes: site.customerNotes ?? '',
  };
}

export function calculateCancellationRefund(booking, now = new Date()) {
  const msPerDay = 86400000;
  const start = parseLocalDate(booking.startDate);
  const daysUntilArrival = Math.floor((start - now) / msPerDay);
  const paidCents = Number(booking.totalCents ?? 0);

  if (daysUntilArrival >= 30) {
    return { refundCents: paidCents, policyTier: 'full', daysUntilArrival };
  }
  if (daysUntilArrival >= 14) {
    return { refundCents: Math.floor(paidCents / 2), policyTier: 'half', daysUntilArrival };
  }
  return { refundCents: 0, policyTier: 'none', daysUntilArrival };
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
    throw new Error('Dates must use YYYY-MM-DD format.');
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function normalizeSiteIds(value) {
  const input = Array.isArray(value) ? value : [value];
  return [...new Set(input
    .map(item => String(item ?? '').trim())
    .filter(Boolean))];
}

function siteIdsForStay(stay = {}) {
  const ids = [
    ...(Array.isArray(stay.rvSiteIds) ? stay.rvSiteIds : []),
    ...(Array.isArray(stay.siteIds) ? stay.siteIds : []),
    ...(Array.isArray(stay.quote?.siteIds) ? stay.quote.siteIds : []),
    stay.rvSiteId,
  ];
  return normalizeSiteIds(ids);
}
