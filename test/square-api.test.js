import test from 'node:test';
import assert from 'node:assert/strict';

import {
  batchRetrieveSquareInventoryCounts,
  createRvCheckoutPaymentLink,
  createRvOrderForBooking,
  createRvWebPaymentSession,
  createSquareRefund,
  createSquareWebPayment,
  hasSquareConfig,
  listSquareCatalogItems,
  listSquarePayments,
  normalizeSquareCatalogItemsForInventory,
  searchSquareOrders,
  squareIdempotencyKey,
  squareRequest,
  validateSquareCheckoutConfig,
} from '../src/lib/square-api.js';

test('Square catalog, payments, and inventory reads consume every result page', async () => {
  const catalogCursors = [];
  const catalog = await listSquareCatalogItems({
    env: { accessToken: 'token', environment: 'sandbox' },
    fetchImpl: async url => {
      const cursor = new URL(url).searchParams.get('cursor');
      catalogCursors.push(cursor);
      return new Response(JSON.stringify(cursor ? { objects: [{ id: 'ITEM-2' }] } : { objects: [{ id: 'ITEM-1' }], cursor: 'CATALOG-NEXT' }), { status: 200 });
    },
  });
  assert.deepEqual(catalog.map(item => item.id), ['ITEM-1', 'ITEM-2']);
  assert.deepEqual(catalogCursors, [null, 'CATALOG-NEXT']);

  const paymentCursors = [];
  const payments = await listSquarePayments({
    locationId: 'MIDWAY',
    env: { accessToken: 'token', environment: 'sandbox' },
    fetchImpl: async url => {
      const cursor = new URL(url).searchParams.get('cursor');
      paymentCursors.push(cursor);
      const payment = cursor
        ? { id: 'PAY-2', status: 'COMPLETED', amount_money: { amount: 500 } }
        : { id: 'PAY-1', status: 'COMPLETED', amount_money: { amount: 900 }, refunded_money: { amount: 200 } };
      return new Response(JSON.stringify(cursor ? { payments: [payment] } : { payments: [payment], cursor: 'PAYMENT-NEXT' }), { status: 200 });
    },
  });
  assert.deepEqual(paymentCursors, [null, 'PAYMENT-NEXT']);
  assert.equal(payments[0].netAmountCents, 700);
  assert.equal(payments[1].netAmountCents, 500);

  const inventoryBodies = [];
  const counts = await batchRetrieveSquareInventoryCounts({
    catalogObjectIds: ['VAR-1'],
    locationIds: ['MIDWAY'],
    env: { accessToken: 'token', environment: 'sandbox' },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      inventoryBodies.push(body);
      const count = { catalog_object_id: body.cursor ? 'VAR-2' : 'VAR-1', location_id: 'MIDWAY', state: 'IN_STOCK', quantity: body.cursor ? '4' : '3' };
      return new Response(JSON.stringify(body.cursor ? { counts: [count] } : { counts: [count], cursor: 'INVENTORY-NEXT' }), { status: 200 });
    },
  });
  assert.equal(counts.length, 2);
  assert.equal(inventoryBodies[1].cursor, 'INVENTORY-NEXT');
});

test('Square order history search paginates completed orders with matching closed-at sort', async () => {
  const requests = [];
  const pages = [
    { orders: [{ id: 'ORDER-1' }], cursor: 'NEXT' },
    { orders: [{ id: 'ORDER-2' }] },
  ];
  const orders = await searchSquareOrders({
    locationIds: ['MIDWAY'], startAt: '2026-01-01T00:00:00Z', endAt: '2026-02-01T00:00:00Z',
    env: { accessToken: 'token', environment: 'sandbox' },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify(pages.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(orders.map(order => order.id), ['ORDER-1', 'ORDER-2']);
  assert.equal(requests[0].query.filter.state_filter.states[0], 'COMPLETED');
  assert.equal(requests[0].query.sort.sort_field, 'CLOSED_AT');
  assert.equal(requests[1].cursor, 'NEXT');
});

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
        webhookSignatureKey: 'webhook-signature-key',
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

test('checkout rejects hosted payment links in production without webhook signing', async () => {
  await assert.rejects(
    () => createRvCheckoutPaymentLink({
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
      fetchImpl: async () => {
        throw new Error('Square should not be called without webhook signing.');
      },
    }),
    /webhook signature key/,
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
      webhookSignatureKey: 'webhook-signature-key',
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
  assert.equal(requestBody.pre_populated_data, undefined);
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

test('checkout does not send buyer contact prefill that can block payment links', async () => {
  let requestBody;
  await createRvCheckoutPaymentLink({
    hold,
    bookingCode: 'MW-ABC123',
    customer: { phone: '555-0101', email: 'not-an-email' },
    redirectUrl: 'https://example.com/return',
    env: {
      accessToken: 'token',
      locationId: 'location',
      environment: 'production',
      nodeEnv: 'production',
      webhookSignatureKey: 'webhook-signature-key',
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

  assert.equal(requestBody.pre_populated_data, undefined);
});

test('checkout rejects Square payment link responses without a URL', async () => {
  await assert.rejects(
    () => createRvCheckoutPaymentLink({
      hold,
      bookingCode: 'MW-ABC123',
      customer: { phone: '509-555-0101' },
      redirectUrl: 'https://example.com/return',
      env: {
        accessToken: 'token',
        locationId: 'location',
        environment: 'production',
        nodeEnv: 'production',
        webhookSignatureKey: 'webhook-signature-key',
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          payment_link: { id: 'plink' },
          related_resources: { orders: [{ id: 'order' }] },
        }),
      }),
    }),
    /payment link URL/,
  );
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
      webhookSignatureKey: 'webhook-signature-key',
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

test('checkout adds extra vehicles as a Square fee line item', async () => {
  let requestBody;
  await createRvCheckoutPaymentLink({
    hold: {
      ...hold,
      quote: {
        ...hold.quote,
        vehicles: 3,
        extraVehicleFeeCents: 2000,
        totalCents: 13600,
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
      webhookSignatureKey: 'webhook-signature-key',
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

  assert.deepEqual(requestBody.order.line_items[1], {
    name: 'Extra vehicle',
    note: '2 extra vehicles · 2026-06-01 to 2026-06-03',
    quantity: '2',
    base_price_money: { amount: 1000, currency: 'USD' },
    metadata: {
      rv_site_id: 'rv-01',
      start_date: '2026-06-01',
      end_date: '2026-06-03',
      fee_type: 'extra_vehicle',
    },
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
  const requests = [];
  const payment = await createSquareWebPayment({
    booking: {
      bookingCode: 'MW-ABC123',
      rvSiteId: 'rv-01',
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      nights: 2,
      vehicles: 1,
      subtotalCents: 11600,
      feeCents: 0,
      totalCents: 11600,
      currency: 'USD',
      customerEmail: 'guest@example.com',
      squareCatalogObjectId: 'SQUARE_VARIATION_50A',
      sku: 'RV-50A-NIGHT',
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
      const requestBody = JSON.parse(options.body);
      requests.push({ url, body: requestBody });
      if (url.endsWith('/v2/orders')) {
        return {
          ok: true,
          json: async () => ({ order: { id: 'order-123' } }),
        };
      }
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

  assert.equal(requests[0].url, 'https://connect.squareup.com/v2/orders');
  assert.equal(requests[0].body.order.line_items[0].catalog_object_id, 'SQUARE_VARIATION_50A');
  assert.equal(requests[1].url, 'https://connect.squareup.com/v2/payments');
  assert.deepEqual(requests[1].body, {
    idempotency_key: 'payment-key-123',
    source_id: 'cnon:card-nonce-ok',
    amount_money: { amount: 11600, currency: 'USD' },
    location_id: 'location',
    order_id: 'order-123',
    reference_id: 'MW-ABC123',
    note: 'RV booking MW-ABC123',
    autocomplete: true,
    buyer_email_address: 'guest@example.com',
    verification_token: 'verification-token',
  });
  assert.equal(payment.mode, 'square');
  assert.equal(payment.paymentId, 'payment-123');
  assert.equal(payment.status, 'COMPLETED');
  assert.equal(payment.orderId, 'order-123');
});

test('web payment clamps Square idempotency keys to the payment API limit', async () => {
  const requests = [];
  const payment = await createSquareWebPayment({
    booking: {
      bookingCode: 'MW-ABC123',
      rvSiteId: 'rv-01',
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      nights: 2,
      vehicles: 1,
      subtotalCents: 11600,
      feeCents: 0,
      totalCents: 11600,
      currency: 'USD',
    },
    sourceId: 'cnon:card-nonce-ok',
    idempotencyKey: 'payment-mw-abcd12-apple-pay-12345678-1234-1234-1234-123456789abc',
    env: {
      accessToken: 'token',
      applicationId: 'app',
      locationId: 'location',
      environment: 'production',
      nodeEnv: 'production',
    },
    fetchImpl: async (url, options) => {
      const requestBody = JSON.parse(options.body);
      requests.push({ url, body: requestBody });
      if (url.endsWith('/v2/orders')) {
        return {
          ok: true,
          json: async () => ({ order: { id: 'order-123' } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          payment: {
            id: 'payment-123',
            status: 'COMPLETED',
            amount_money: requestBody.amount_money,
            order_id: requestBody.order_id,
          },
        }),
      };
    },
  });

  assert.equal(payment.status, 'COMPLETED');
  assert.equal(requests[0].body.idempotency_key.length <= 45, true);
  assert.equal(requests[1].body.idempotency_key.length <= 45, true);
  assert.equal(requests[1].body.idempotency_key, squareIdempotencyKey('payment-mw-abcd12-apple-pay-12345678-1234-1234-1234-123456789abc', 'payment'));
});

test('web payment order builder uses multi-site catalog lines and extra vehicle mapping', async () => {
  let requestBody;
  const orderId = await createRvOrderForBooking({
    booking: {
      bookingCode: 'MW-MULTI',
      rvSiteId: 'rv-03',
      rvSiteIds: ['rv-03', 'rv-11'],
      siteLines: [
        {
          siteId: 'rv-03',
          siteNumber: '03',
          nightlyPriceCents: 4500,
          nights: 2,
          sku: 'MIDWAY-RV-FULL-HOOKUP-NIGHT',
          squareCatalogObjectId: 'VAR_FULL',
        },
        {
          siteId: 'rv-11',
          siteNumber: '11',
          nightlyPriceCents: 4000,
          nights: 2,
          sku: 'MIDWAY-RV-PARTIAL-HOOKUP-NIGHT',
          squareCatalogObjectId: 'VAR_PARTIAL',
        },
      ],
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      nights: 2,
      vehicles: 3,
      subtotalCents: 17000,
      feeCents: 2000,
      totalCents: 19000,
      currency: 'USD',
    },
    idempotencyKey: 'payment-key-multi',
    env: {
      accessToken: 'token',
      applicationId: 'app',
      locationId: 'location',
      environment: 'production',
      nodeEnv: 'production',
      rvVariationIds: {
        extraVehicle: 'VAR_EXTRA',
      },
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ order: { id: 'order-multi' } }),
      };
    },
  });

  assert.equal(orderId, 'order-multi');
  assert.equal(requestBody.order.line_items.length, 3);
  assert.equal(requestBody.order.line_items[0].catalog_object_id, 'VAR_FULL');
  assert.equal(requestBody.order.line_items[1].catalog_object_id, 'VAR_PARTIAL');
  assert.equal(requestBody.order.line_items[2].catalog_object_id, 'VAR_EXTRA');
  assert.equal(requestBody.order.line_items[2].quantity, '2');
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

test('buildSquareItemObject builds a tracked, priced item with one variation', async () => {
  const { buildSquareItemObject } = await import('../src/lib/square-api.js');
  const object = buildSquareItemObject({
    name: '  Snickers King Size ',
    description: 'Candy bar',
    sku: '1002',
    upc: '040000424307',
    priceCents: 299,
    categoryId: 'CAT_1',
  });
  assert.equal(object.type, 'ITEM');
  assert.equal(object.item_data.name, 'Snickers King Size');
  assert.deepEqual(object.item_data.categories, [{ id: 'CAT_1' }]);
  const variation = object.item_data.variations[0].item_variation_data;
  assert.equal(variation.sku, '1002');
  assert.equal(variation.upc, '040000424307');
  assert.equal(variation.track_inventory, true);
  assert.equal(variation.pricing_type, 'FIXED_PRICING');
  assert.deepEqual(variation.price_money, { amount: 299, currency: 'USD' });

  const noPrice = buildSquareItemObject({ name: 'Mystery item' });
  assert.equal(noPrice.item_data.variations[0].item_variation_data.pricing_type, 'VARIABLE_PRICING');
  assert.equal('categories' in noPrice.item_data, false);
  assert.throws(() => buildSquareItemObject({ name: '   ' }), /item name/i);
});
