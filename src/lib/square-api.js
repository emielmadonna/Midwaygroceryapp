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

export function normalizeSquareCatalogItemsForInventory(objects = []) {
  const rows = [];
  for (const object of objects ?? []) {
    const itemData = object.itemData ?? object.item_data ?? {};
    const variations = itemData.variations ?? [];
    const category = itemData.categories?.[0]?.name
      ?? itemData.category_id
      ?? object.category
      ?? 'Store';
    const hidden = isSquareItemHidden(object, itemData);

    for (const variation of variations) {
      const variationData = variation.itemVariationData ?? variation.item_variation_data ?? {};
      const priceMoney = variationData.priceMoney ?? variationData.price_money ?? {};
      const amount = typeof priceMoney.amount === 'bigint'
        ? Number(priceMoney.amount)
        : Number(priceMoney.amount ?? 0);
      rows.push({
        squareId: variation.id,
        squareItemId: object.id,
        squareVariationId: variation.id,
        sku: variationData.sku ?? '',
        name: [itemData.name, variationData.name].filter(Boolean).join(' - ') || itemData.name || variationData.name || '',
        description: itemData.description ?? '',
        priceCents: Number.isFinite(amount) ? amount : 0,
        currency: priceMoney.currency ?? 'USD',
        category,
        active: object.is_deleted !== true && variation.is_deleted !== true && itemData.is_archived !== true,
        hidden,
        source: 'square',
        updatedAt: variation.updated_at ?? object.updated_at ?? null,
      });
    }
  }
  return rows.filter(row => row.squareItemId && row.squareVariationId && row.name);
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

  const siteNumbers = hold.quote.siteNumbers?.length ? hold.quote.siteNumbers : [hold.quote.siteNumber];
  const description = `RV Site${siteNumbers.length === 1 ? '' : 's'} ${siteNumbers.join(', ')}, ${hold.startDate} to ${hold.endDate}`;
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
        rv_site_ids: (hold.rvSiteIds ?? hold.siteIds ?? hold.quote.siteIds ?? [hold.rvSiteId]).join(','),
      },
      line_items: createRvLineItems(hold, {
        extraVehicleCatalogObjectId: extraVehicleCatalogObjectId(env),
      }),
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
  const orderId = booking.squareOrderId || await createRvOrderForBooking({
    booking,
    env,
    fetchImpl,
    idempotencyKey,
  });
  const payload = {
    idempotency_key: idempotencyKey || `payment-${booking.bookingCode}`,
    source_id: sourceId,
    amount_money: {
      amount: amountCents,
      currency: booking.currency || 'USD',
    },
    location_id: squareConfig.locationId,
    order_id: orderId || undefined,
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
    orderId: payment.order_id ?? orderId ?? null,
  };
}

export async function createRvOrderForBooking({
  booking,
  env = {},
  fetchImpl = globalThis.fetch,
  idempotencyKey,
} = {}) {
  if (!booking) throw new Error('Booking is required.');

  const squareConfig = validateSquareCheckoutConfig({
    ...env,
    checkoutSurface: 'payment-link',
  });
  const hold = holdFromBooking(booking);
  const result = await squareRequest('/v2/orders', {
    method: 'POST',
    env,
    fetchImpl,
    body: {
      idempotency_key: `${idempotencyKey || `payment-${booking.bookingCode}`}-order`,
      order: {
        location_id: squareConfig.locationId,
        reference_id: booking.bookingCode,
        metadata: {
          booking_code: booking.bookingCode,
          hold_id: booking.holdId || '',
          rv_site_id: booking.rvSiteId || '',
          rv_site_ids: (booking.rvSiteIds ?? booking.siteIds ?? [booking.rvSiteId].filter(Boolean)).join(','),
        },
        line_items: createRvLineItems(hold, {
          extraVehicleCatalogObjectId: extraVehicleCatalogObjectId(env),
        }),
      },
    },
  });

  return result.order?.id ?? null;
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

function createRvLineItems(hold, { extraVehicleCatalogObjectId = null } = {}) {
  const siteLines = Array.isArray(hold.quote?.sites) && hold.quote.sites.length
    ? hold.quote.sites
    : null;
  const lineItems = siteLines
    ? siteLines.map(line => {
      const lineItem = {
        name: `RV Site ${line.siteNumber}`,
        note: `${hold.startDate} to ${hold.endDate} · ${line.sku || 'RV nightly stay'}`,
        quantity: String(line.nights || hold.quote.nights),
        base_price_money: {
          amount: line.nightlyPriceCents,
          currency: hold.quote.currency,
        },
        metadata: {
          rv_site_id: line.siteId,
          start_date: hold.startDate,
          end_date: hold.endDate,
          sku: line.sku || '',
        },
      };
      if (line.squareCatalogObjectId) lineItem.catalog_object_id = line.squareCatalogObjectId;
      return lineItem;
    })
    : [createRvLineItem(hold)];
  const extraVehicles = Math.max(0, Number(hold.quote?.vehicles || 1) - 1);
  const extraVehicleFeeCents = Number(hold.quote?.extraVehicleFeeCents || 0);

  if (extraVehicles > 0 && extraVehicleFeeCents > 0) {
    const lineItem = {
      name: 'Extra vehicle',
      note: `${extraVehicles} extra vehicle${extraVehicles === 1 ? '' : 's'} · ${hold.startDate} to ${hold.endDate}`,
      quantity: String(extraVehicles),
      base_price_money: {
        amount: Math.round(extraVehicleFeeCents / extraVehicles),
        currency: hold.quote.currency,
      },
      metadata: {
        rv_site_id: hold.rvSiteId,
        start_date: hold.startDate,
        end_date: hold.endDate,
        fee_type: 'extra_vehicle',
      },
    };
    if (extraVehicleCatalogObjectId) lineItem.catalog_object_id = extraVehicleCatalogObjectId;
    lineItems.push(lineItem);
  }

  return lineItems;
}

function holdFromBooking(booking) {
  const siteLines = Array.isArray(booking.siteLines) && booking.siteLines.length
    ? booking.siteLines
    : null;
  const nights = Number(booking.nights || 1);
  const currency = booking.currency || 'USD';
  const siteIds = booking.rvSiteIds ?? booking.siteIds ?? [booking.rvSiteId].filter(Boolean);

  return {
    id: booking.holdId || booking.id || booking.bookingCode,
    rvSiteId: booking.rvSiteId,
    rvSiteIds: siteIds,
    siteIds,
    startDate: booking.startDate,
    endDate: booking.endDate,
    quote: {
      siteNumber: siteNumberFromBooking(booking),
      siteNumbers: siteLines?.map(line => line.siteNumber).filter(Boolean) ?? [siteNumberFromBooking(booking)].filter(Boolean),
      siteIds,
      sites: siteLines,
      nights,
      vehicles: Number(booking.vehicles || 1),
      extraVehicleFeeCents: Number(booking.feeCents || 0),
      nightlyPriceCents: nights > 0 ? Math.round(Number(booking.subtotalCents || 0) / nights) : Number(booking.subtotalCents || 0),
      squareCatalogObjectId: booking.squareCatalogObjectId ?? null,
      sku: booking.sku || '',
      totalCents: Number(booking.totalCents || 0),
      currency,
    },
  };
}

function siteNumberFromBooking(booking = {}) {
  const raw = String(booking.siteNumber || booking.rvSiteId || booking.siteId || '').trim();
  return raw.replace(/^rv-/, '').replace(/^tent-/, 'T') || raw;
}

function extraVehicleCatalogObjectId(config = {}) {
  const ids = readSquareValue(config, 'rvVariationIds') || {};
  return ids.extraVehicle || ids.extra_vehicle || ids.extraVehicleFee || null;
}

function isSquareItemHidden(object = {}, itemData = {}) {
  const visibility = String(
    itemData.ecom_visibility
    ?? itemData.visibility
    ?? object.ecom_visibility
    ?? '',
  ).toUpperCase();
  return visibility === 'HIDDEN' || visibility === 'UNAVAILABLE';
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
