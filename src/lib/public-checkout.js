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
  const booking = sanitizeIdempotencyPart(bookingCode) || 'booking';
  const method = sanitizeIdempotencyPart(methodLabel) || 'payment';
  const suffix = sanitizeIdempotencyPart(randomSource()) || String(Date.now());
  return `payment-${booking}-${method}-${suffix}`.slice(0, 192);
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

function defaultRandomSource() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
