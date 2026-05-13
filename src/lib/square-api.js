import crypto from 'node:crypto';

const DEFAULT_SQUARE_VERSION = '2026-01-22';
const SQUARE_ENVIRONMENTS = new Set(['sandbox', 'production']);

export function hasSquareConfig(config = {}) {
  try {
    validateSquareCheckoutConfig(config);
    return true;
  } catch {
    return false;
  }
}

export function validateSquareCheckoutConfig(config = {}) {
  const errors = [];
  const accessToken = readSquareValue(config, 'accessToken');
  const applicationId = readSquareValue(config, 'applicationId');
  const locationId = readSquareValue(config, 'locationId');
  const squareEnvironment = readSquareValue(config, 'environment') || 'sandbox';
  const checkoutSurface = readSquareValue(config, 'checkoutSurface') || 'web-payments';
  const nodeEnv = readSquareValue(config, 'nodeEnv');

  if (!accessToken) errors.push('Square access token is required');
  if (checkoutSurface !== 'payment-link' && !applicationId) errors.push('Square application ID is required');
  if (!locationId) errors.push('Square location ID is required');
  if (!SQUARE_ENVIRONMENTS.has(squareEnvironment)) {
    errors.push('Square environment must be "sandbox" or "production"');
  }
  if (nodeEnv === 'production' && squareEnvironment !== 'production') {
    errors.push('Square environment must be production when the platform is running in production');
  }

  if (errors.length > 0) {
    throw new Error(`Square checkout is not configured: ${errors.join('; ')}.`);
  }

  return {
    accessToken,
    applicationId,
    locationId,
    squareEnvironment,
    checkoutSurface,
  };
}

export async function squareRequest(path, {
  method = 'GET',
  body,
  env = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  const accessToken = readSquareValue(env, 'accessToken');
  const squareEnvironment = readSquareValue(env, 'environment') || 'sandbox';
  const nodeEnv = readSquareValue(env, 'nodeEnv');
  if (!accessToken) {
    throw new Error('Square access token is not configured.');
  }

  if (!SQUARE_ENVIRONMENTS.has(squareEnvironment)) {
    throw new Error('Square environment must be "sandbox" or "production".');
  }
  if (nodeEnv === 'production' && squareEnvironment !== 'production') {
    throw new Error('Square environment must be production when the platform is running in production.');
  }

  const baseUrl = squareEnvironment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': readSquareValue(env, 'apiVersion') || DEFAULT_SQUARE_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.errors?.[0]?.detail || data.errors?.[0]?.code || `Square request failed with ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export async function listSquareCatalogItems(options = {}) {
  const result = await squareRequest('/v2/catalog/list?types=ITEM', options);
  return result.objects ?? [];
}

export async function createRvCheckoutPaymentLink({
  hold,
  bookingCode,
  customer,
  redirectUrl,
  env = {},
  fetchImpl = globalThis.fetch,
}) {
  let squareConfig;
  try {
    squareConfig = validateSquareCheckoutConfig({
      ...env,
      checkoutSurface: 'payment-link',
    });
  } catch (error) {
    throw error;
  }

  const siteNumber = hold.quote.siteNumber;
  const description = `RV Site ${siteNumber}, ${hold.startDate} to ${hold.endDate}`;
  const payload = {
    idempotency_key: `rv-${hold.id}`,
    description,
    payment_note: bookingCode,
    order: {
      location_id: squareConfig.locationId,
      reference_id: bookingCode,
      metadata: {
        booking_code: bookingCode,
        hold_id: hold.id,
        rv_site_id: hold.rvSiteId,
      },
      line_items: [
        createRvLineItem(hold),
      ],
    },
    checkout_options: {
      ask_for_shipping_address: false,
      redirect_url: redirectUrl,
    },
    pre_populated_data: {
      buyer_email: customer?.email || undefined,
      buyer_phone_number: customer?.phone || undefined,
    },
  };

  let result;
  try {
    result = await squareRequest('/v2/online-checkout/payment-links', {
      method: 'POST',
      body: payload,
      env,
      fetchImpl,
    });
  } catch (error) {
    throw error;
  }

  return {
    mode: 'square',
    paymentLinkId: result.payment_link?.id,
    orderId: result.related_resources?.orders?.[0]?.id,
    checkoutUrl: result.payment_link?.url,
  };
}

export function createRvWebPaymentSession({
  hold,
  bookingCode,
  env = {},
}) {
  const applicationId = readSquareValue(env, 'applicationId');
  const locationId = readSquareValue(env, 'locationId');
  const squareEnvironment = readSquareValue(env, 'environment') || 'sandbox';
  const nodeEnv = readSquareValue(env, 'nodeEnv');

  if (!applicationId || !locationId || !SQUARE_ENVIRONMENTS.has(squareEnvironment)) {
    const errors = [];
    if (!applicationId) errors.push('Square application ID is required');
    if (!locationId) errors.push('Square location ID is required');
    if (!SQUARE_ENVIRONMENTS.has(squareEnvironment)) errors.push('Square environment must be "sandbox" or "production"');
    throw new Error(`Square checkout is not configured: ${errors.join('; ')}.`);
  }
  if (nodeEnv === 'production' && squareEnvironment !== 'production') {
    throw new Error('Square checkout is not configured: Square environment must be production when the platform is running in production.');
  }

  return {
    mode: 'web-payments',
    applicationId,
    locationId,
    environment: squareEnvironment,
    bookingCode,
    amountCents: hold.quote.totalCents,
    currency: hold.quote.currency,
  };
}

export async function createSquareWebPayment({
  booking,
  sourceId,
  verificationToken,
  idempotencyKey,
  env = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!booking) throw new Error('Booking is required.');
  if (!sourceId) throw new Error('Square payment source token is required.');

  const amountCents = Number(booking.totalCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Booking payment amount is invalid.');
  }

  const squareConfig = validateSquareCheckoutConfig(env);
  const payload = {
    idempotency_key: idempotencyKey || `payment-${booking.bookingCode}`,
    source_id: sourceId,
    amount_money: {
      amount: amountCents,
      currency: booking.currency || 'USD',
    },
    location_id: squareConfig.locationId,
    reference_id: booking.bookingCode,
    note: `RV booking ${booking.bookingCode}`,
    autocomplete: true,
  };

  if (booking.customerEmail) payload.buyer_email_address = booking.customerEmail;
  if (verificationToken) payload.verification_token = verificationToken;

  const result = await squareRequest('/v2/payments', {
    method: 'POST',
    body: payload,
    env,
    fetchImpl,
  });
  const payment = result.payment ?? {};

  return {
    mode: 'square',
    paymentId: payment.id,
    status: payment.status,
    amountCents: Number(payment.amount_money?.amount ?? amountCents),
    currency: payment.amount_money?.currency ?? booking.currency ?? 'USD',
    receiptUrl: payment.receipt_url ?? null,
    orderId: payment.order_id ?? null,
  };
}

export async function createSquareRefund({
  booking,
  amountCents,
  reason,
  idempotencyKey,
  env = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!booking) throw new Error('Booking is required.');
  const refundAmountCents = Number(amountCents ?? booking.totalCents);
  if (!Number.isInteger(refundAmountCents) || refundAmountCents <= 0) {
    throw new Error('Refund amount must be a positive whole-cent amount.');
  }
  if (refundAmountCents > Number(booking.totalCents ?? 0)) {
    throw new Error('Refund amount cannot exceed the booking total.');
  }

  const paymentId = booking.squarePaymentId;
  if (!paymentId) {
    throw new Error('Booking does not have a Square payment id to refund.');
  }

  validateSquareCheckoutConfig({
    ...env,
    checkoutSurface: 'payment-link',
  });
  const payload = {
    idempotency_key: idempotencyKey || `refund-${booking.bookingCode}-${refundAmountCents}`,
    payment_id: paymentId,
    amount_money: {
      amount: refundAmountCents,
      currency: booking.currency || 'USD',
    },
    reason: reason || `Refund for booking ${booking.bookingCode}`,
  };

  const result = await squareRequest('/v2/refunds', {
    method: 'POST',
    body: payload,
    env,
    fetchImpl,
  });
  const refund = result.refund ?? {};

  return {
    mode: 'square',
    refundId: refund.id,
    status: refund.status,
    amountCents: Number(refund.amount_money?.amount ?? refundAmountCents),
    currency: refund.amount_money?.currency ?? booking.currency ?? 'USD',
    paymentId: refund.payment_id ?? paymentId,
    reason: reason || null,
  };
}

function readSquareValue(config, key) {
  const value = config?.[key];
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' ? value.trim() : value;
}

function createRvLineItem(hold) {
  const lineItem = {
    name: `RV Site ${hold.quote.siteNumber}`,
    note: `${hold.startDate} to ${hold.endDate} · ${hold.quote.sku || 'RV nightly stay'}`,
    quantity: String(hold.quote.nights),
    base_price_money: {
      amount: hold.quote.nightlyPriceCents,
      currency: hold.quote.currency,
    },
    metadata: {
      rv_site_id: hold.rvSiteId,
      start_date: hold.startDate,
      end_date: hold.endDate,
      sku: hold.quote.sku || '',
    },
  };

  if (hold.quote.squareCatalogObjectId) {
    lineItem.catalog_object_id = hold.quote.squareCatalogObjectId;
  }

  return lineItem;
}

export function verifySquareWebhookSignature({ rawBody, signature, notificationUrl, signatureKey }) {
  if (!rawBody || !signature || !notificationUrl || !signatureKey) return false;
  const hmac = crypto.createHmac('sha256', signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expected = hmac.digest('base64');

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
