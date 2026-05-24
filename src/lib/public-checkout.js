export function squareAmount(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

export function checkoutAmountCents({ checkout = {}, session = {} } = {}) {
  return Number(
    checkout.amountCents
      ?? session.hold?.quote?.totalCents
      ?? session.booking?.totalCents
      ?? 0,
  );
}

export function buildSquarePaymentRequest({ checkout = {}, amountCents } = {}) {
  return {
    countryCode: 'US',
    currencyCode: checkout.currency || 'USD',
    total: {
      amount: squareAmount(amountCents),
      label: 'Midway reservation',
    },
  };
}

export function buildSquareVerificationDetails({ checkout = {}, session = {}, amountCents } = {}) {
  const guest = session.guest || {};
  return {
    amount: squareAmount(amountCents),
    billingContact: {
      email: guest.email || undefined,
      phone: guest.phone || undefined,
      givenName: firstName(guest.name),
      familyName: lastName(guest.name),
    },
    currencyCode: checkout.currency || 'USD',
    intent: 'CHARGE',
  };
}

export function createPaymentIdempotencyKey(bookingCode, methodLabel, randomSource = defaultRandomSource) {
  const maxLength = 45;
  const booking = sanitizeIdempotencyPart(bookingCode) || 'booking';
  const method = sanitizeIdempotencyPart(methodLabel) || 'payment';
  const suffix = sanitizeIdempotencyPart(randomSource()) || String(Date.now());
  const base = `payment-${booking}-${method}`;
  const suffixLength = maxLength - base.length - 1;
  if (suffixLength >= 8) return `${base}-${suffix.slice(0, suffixLength)}`;

  const compactBase = `pay-${booking.slice(0, 12)}-${method.slice(0, 8)}`;
  const compactSuffixLength = Math.max(8, maxLength - compactBase.length - 1);
  return `${compactBase}-${suffix.slice(0, compactSuffixLength)}`.slice(0, maxLength);
}

export function addLocalDateDays(dateValue, days) {
  const date = parseDateInput(dateValue);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function dateRangeNights(startDate, endDate) {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);
  return Math.round((end - start) / 86400000);
}

export function normalizeDepartureDate({
  previousStartDate,
  nextStartDate,
  departureDate,
  minimumNights = 1,
} = {}) {
  if (!isDateInput(nextStartDate)) return departureDate || '';
  const minNights = Math.max(1, Math.trunc(Number(minimumNights) || 1));
  const currentNights = isDateInput(previousStartDate) && isDateInput(departureDate)
    ? dateRangeNights(previousStartDate, departureDate)
    : minNights;
  const preservedNights = Math.max(minNights, currentNights);

  if (isDateInput(departureDate) && dateRangeNights(nextStartDate, departureDate) >= minNights) {
    return departureDate;
  }

  return addLocalDateDays(nextStartDate, preservedNights);
}

function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || undefined;
}

function lastName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(' ') : undefined;
}

function sanitizeIdempotencyPart(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function isDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function parseDateInput(value) {
  if (!isDateInput(value)) throw new Error('Dates must use YYYY-MM-DD format.');
  return new Date(`${value}T00:00:00.000Z`);
}

function defaultRandomSource() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
