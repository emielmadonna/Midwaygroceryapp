import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRvCheckoutPaymentLink,
  createRvWebPaymentSession,
  createSquareRefund,
  createSquareWebPayment,
  hasSquareConfig,
  normalizeSquareCatalogItemsForInventory,
  squareRequest,
  validateSquareCheckoutConfig,
} from '../src/lib/square-api.js';

const hold = {
  id: 'hold-123',
  rvSiteId: 'rv-01',
  startDate: '2026-06-01',
  endDate: '2026-06-03',
  quote: {
    siteNumber: '01',
    nights: 2,
    nightlyPriceCents: 5800,
    totalCents: 11600,
    currency: 'USD',
    sku: 'RV-50A-NIGHT',
    squareCatalogObjectId: 'SQUARE_VARIATION_50A',
  },
};

test('checkout rejects missing Square credentials', async () => {
  await assert.rejects(
    () => createRvCheckoutPaymentLink({
      hold,
      bookingCode: 'MW-ABC123',
      customer: { phone: '509-555-0101' },
      redirectUrl: 'https://example.com/return',
      env: {},
    }),
    /Square access token is required/,
  );
});

test('checkout rejects missing Square credentials in production', async () => {
  await assert.rejects(
    () => createRvCheckoutPaymentLink({
      hold,
      bookingCode: 'MW-ABC123',
      customer: { phone: '509-555-0101' },
      redirectUrl: 'https://example.com/return',
      env: { nodeEnv: 'production' },
    }),
    /Square access token is required; Square location ID is required; Square environment must be production/,
  );
});

test('local checkout validates Square credentials instead of synthesizing checkout', async () => {
  await assert.rejects(
    () => createRvCheckoutPaymentLink({
      hold,
      bookingCode: 'MW-ABC123',
      customer: { phone: '509-555-0101' },
      redirectUrl: 'https://example.com/return',
      env: {
        accessToken: 'token',
        nodeEnv: 'development',
      },
    }),
    /Square location ID is required/,
  );
});

test('Square checkout config helper validates required provider config', () => {
  assert.equal(hasSquareConfig({}), false);
  assert.equal(hasSquareConfig({
    accessToken: '   ',
    locationId: 'location',
  }), false);
  assert.equal(hasSquareConfig({
    accessToken: 'token',
    locationId: 'location',
    environment: 'sandbox',
  }), false);
  assert.equal(hasSquareConfig({
    accessToken: 'token',
    applicationId: 'app',
    locationId: 'location',
    environment: 'sandbox',
  }), true);
  assert.equal(hasSquareConfig({
    accessToken: 'token',
    checkoutSurface: 'payment-link',
    locationId: 'location',
    environment: 'production',
    nodeEnv: 'production',
  }), true);

  assert.throws(
    () => validateSquareCheckoutConfig({
      accessToken: 'token',
      locationId: 'location',
      environment: 'sandbox',
      nodeEnv: 'production',
    }),
    /Square application ID is required; Square environment must be production/,
  );
});

test('Square request helper rejects sandbox defaults in production', async () => {
  await assert.rejects(
    () => squareRequest('/v2/catalog/list?types=ITEM', {
      env: {
        accessToken: 'token',
        nodeEnv: 'production',
      },
      fetchImpl: async () => {
        throw new Error('fetch should not be called');
      },
    }),
    /Square environment must be production/,
  );
});

test('Square catalog items flatten into persisted inventory rows', () => {
  const rows = normalizeSquareCatalogItemsForInventory([
    {
      id: 'ITEM_1',
      updated_at: '2026-05-01T00:00:00Z',
      item_data: {
        name: 'Firewood Bundle',
        description: 'Local bundle',
        categories: [{ name: 'Camping' }],
        variations: [
          {
            id: 'VAR_1',
            item_variation_data: {
              sku: 'FIREWOOD',
              price_money: { amount: 800, currency: 'USD' },
            },
          },
        ],
      },
    },
  ]);

  assert.deepEqual(rows, [
    {
      squareId: 'VAR_1',
      squareItemId: 'ITEM_1',
      squareVariationId: 'VAR_1',
      sku: 'FIREWOOD',
      name: 'Firewood Bundle',
      description: 'Local bundle',
      priceCents: 800,
      currency: 'USD',
      category: 'Camping',
      active: true,
      hidden: false,
      source: 'square',
      updatedAt: '2026-05-01T00:00:00Z',
    },
  ]);
});

test('checkout does not synthesize failed Square requests in development', async () => {
  await assert.rejects(
    () => createRvCheckoutPaymentLink({
      hold,
      bookingCode: 'MW-ABC123',
      customer: { phone: '509-555-0101' },
      redirectUrl: 'https://example.com/return',
      env: {
        accessToken: 'bad-token',
        locationId: 'bad-location',
        environment: 'sandbox',
        nodeEnv: 'development',
      },
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ errors: [{ detail: 'This request could not be authorized.' }] }),
      }),
    }),
    /authorized/,
  );
});

test('checkout does not synthesize failed Square requests in production', async () => {
  await assert.rejects(
    () => createRvCheckoutPaymentLink({
      hold,
      bookingCode: 'MW-ABC123',
      customer: { phone: '509-555-0101' },
      redirectUrl: 'https://example.com/return',
      env: {
        accessToken: 'bad-token',
        locationId: 'bad-location',
        environment: 'production',
        nodeEnv: 'production',
      },
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ errors: [{ detail: 'This request could not be authorized.' }] }),
      }),
    }),
    /authorized/,
  );
});

test('checkout sends RV nightly SKU as a Square catalog line item', async () => {
  let requestBody;
  let requestUrl;
  await createRvCheckoutPaymentLink({
    hold,
    bookingCode: 'MW-ABC123',
    customer: { phone: '509-555-0101' },
    redirectUrl: 'https://example.com/return',
    env: {
      accessToken: 'token',
      locationId: 'location',
      environment: 'production',
      nodeEnv: 'production',
    },
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          payment_link: { id: 'plink', url: 'https://square.test/checkout' },
          related_resources: { orders: [{ id: 'order' }] },
        }),
      };
    },
  });

  assert.equal(requestUrl, 'https://connect.squareup.com/v2/online-checkout/payment-links');
  assert.equal(requestBody.payment_note, 'MW-ABC123');
  assert.equal(requestBody.order.location_id, 'location');
  assert.equal(requestBody.order.reference_id, 'MW-ABC123');
  assert.deepEqual(requestBody.order.line_items[0], {
    name: 'RV Site 01',
    note: '2026-06-01 to 2026-06-03 · RV-50A-NIGHT',
    quantity: '2',
    base_price_money: { amount: 5800, currency: 'USD' },
    metadata: {
      rv_site_id: 'rv-01',
      start_date: '2026-06-01',
      end_date: '2026-06-03',
      sku: 'RV-50A-NIGHT',
    },
    catalog_object_id: 'SQUARE_VARIATION_50A',
  });
});

test('checkout sends a custom amount line item when no Square catalog variation is mapped', async () => {
  let requestBody;
  await createRvCheckoutPaymentLink({
    hold: {
      ...hold,
      quote: {
        ...hold.quote,
        nights: 3,
        squareCatalogObjectId: null,
      },
    },
    bookingCode: 'MW-ABC123',
    customer: { phone: '509-555-0101' },
    redirectUrl: 'https://example.com/return',
    env: {
      accessToken: 'token',
      locationId: 'location',
      environment: 'production',
      nodeEnv: 'production',
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          payment_link: { id: 'plink', url: 'https://square.test/checkout' },
          related_resources: { orders: [{ id: 'order' }] },
        }),
      };
    },
  });

  assert.equal(requestBody.order.line_items[0].quantity, '3');
  assert.equal(requestBody.order.line_items[0].catalog_object_id, undefined);
  assert.deepEqual(requestBody.order.line_items[0].base_price_money, {
    amount: 5800,
    currency: 'USD',
  });
});

test('web payments session exposes only public Square browser configuration', () => {
  const checkout = createRvWebPaymentSession({
    hold,
    bookingCode: 'MW-ABC123',
    env: {
      accessToken: 'server-token',
      applicationId: 'sandbox-app-id',
      locationId: 'location',
      environment: 'sandbox',
    },
  });

  assert.deepEqual(checkout, {
    mode: 'web-payments',
    applicationId: 'sandbox-app-id',
    locationId: 'location',
    environment: 'sandbox',
    bookingCode: 'MW-ABC123',
    amountCents: 11600,
    currency: 'USD',
  });
});

test('web payment calls Square Payments API with tokenized source id', async () => {
  let requestUrl;
  let requestBody;
  const payment = await createSquareWebPayment({
    booking: {
      bookingCode: 'MW-ABC123',
      totalCents: 11600,
      currency: 'USD',
      customerEmail: 'guest@example.com',
    },
    sourceId: 'cnon:card-nonce-ok',
    verificationToken: 'verification-token',
    idempotencyKey: 'payment-key-123',
    env: {
      accessToken: 'token',
      applicationId: 'app',
      locationId: 'location',
      environment: 'production',
      nodeEnv: 'production',
    },
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          payment: {
            id: 'payment-123',
            status: 'COMPLETED',
            amount_money: { amount: 11600, currency: 'USD' },
            receipt_url: 'https://square.test/receipt',
          },
        }),
      };
    },
  });

  assert.equal(requestUrl, 'https://connect.squareup.com/v2/payments');
  assert.deepEqual(requestBody, {
    idempotency_key: 'payment-key-123',
    source_id: 'cnon:card-nonce-ok',
    amount_money: { amount: 11600, currency: 'USD' },
    location_id: 'location',
    reference_id: 'MW-ABC123',
    note: 'RV booking MW-ABC123',
    autocomplete: true,
    buyer_email_address: 'guest@example.com',
    verification_token: 'verification-token',
  });
  assert.equal(payment.mode, 'square');
  assert.equal(payment.paymentId, 'payment-123');
  assert.equal(payment.status, 'COMPLETED');
});

test('refund rejects synthetic payment ids without Square credentials', async () => {
  await assert.rejects(
    () => createSquareRefund({
      booking: {
        bookingCode: 'MW-ABC123',
        totalCents: 11600,
        currency: 'USD',
        squarePaymentId: 'synthetic-payment-MW-ABC123',
      },
      amountCents: 5000,
      reason: 'Guest requested partial refund',
      env: { nodeEnv: 'test' },
    }),
    /Square access token is required/,
  );
});

test('refund calls Square Refunds API in production mode', async () => {
  let requestUrl;
  let requestBody;
  const refund = await createSquareRefund({
    booking: {
      bookingCode: 'MW-ABC123',
      totalCents: 11600,
      currency: 'USD',
      squarePaymentId: 'payment-123',
    },
    amountCents: 11600,
    reason: 'Owner approved',
    idempotencyKey: 'refund-key-123',
    env: {
      accessToken: 'token',
      locationId: 'location',
      environment: 'production',
      nodeEnv: 'production',
    },
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          refund: {
            id: 'refund-123',
            status: 'COMPLETED',
            payment_id: 'payment-123',
            amount_money: { amount: 11600, currency: 'USD' },
          },
        }),
      };
    },
  });

  assert.equal(requestUrl, 'https://connect.squareup.com/v2/refunds');
  assert.deepEqual(requestBody, {
    idempotency_key: 'refund-key-123',
    payment_id: 'payment-123',
    amount_money: { amount: 11600, currency: 'USD' },
    reason: 'Owner approved',
  });
  assert.equal(refund.mode, 'square');
  assert.equal(refund.refundId, 'refund-123');
});
