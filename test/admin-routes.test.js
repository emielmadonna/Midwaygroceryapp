import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

import { createApiRouter } from '../src/api/routes.js';
import { createMidwayHarness } from '../src/lib/midway-harness.js';
import { createTenantConfig } from '../src/lib/tenant-config.js';

const baseEnv = {
  NODE_ENV: 'test',
  ADMIN_OWNER_EMAIL: 'owner@midway.local',
  ADMIN_OWNER_PASSWORD: 'owner-pass',
  ADMIN_EMPLOYEE_EMAIL: 'employee@midway.local',
  ADMIN_EMPLOYEE_PASSWORD: 'employee-pass',
  ADMIN_SESSION_SECRET: 'test-session-secret',
};

test('admin routes require a server-side token', async () => {
  const server = await createTestServer();

  try {
    const response = await fetch(`${server.url}/api/admin/dashboard/today`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'ADMIN_AUTH_REQUIRED');
  } finally {
    await server.close();
  }
});

test('public bootstrap still loads RV booking when Square product sync is unavailable', async () => {
  const env = {
    ...baseEnv,
    FEATURE_FLAGS_JSON: JSON.stringify({ 'inventory.cache': true }),
  };
  const store = createMidwayHarness({ env, tenantConfig: createTestTenantConfig() });
  store.getProviderConfig = async providerKey => {
    if (providerKey === 'square') throw new Error('temporary provider config failure');
    return null;
  };
  const server = await createTestServer({ env, store });

  try {
    const response = await api(server, '/api/public/bootstrap?startDate=2026-06-01&endDate=2026-06-03');

    assert.equal(response.status, 200);
    assert.equal(response.body.data.rvSites.length > 0, true);
    assert.equal(response.body.data.featureFlags.rvBooking, true);
    assert.equal(response.body.data.products.length, 0);
    assert.equal(response.body.data.featureFlags.products, false);
  } finally {
    await server.close();
  }
});

test('owner can create and cancel a manual booking with audit records', async () => {
  const server = await createTestServer();

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const created = await api(server, '/api/admin/bookings', {
      method: 'POST',
      token: owner.token,
      body: {
        siteId: 'rv-03',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        customer: { name: 'Phone Guest', phone: '555-0101' },
      },
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.data.status, 'confirmed');

    const canceled = await api(server, `/api/admin/bookings/${created.body.data.bookingCode}/cancel`, {
      method: 'POST',
      token: owner.token,
      body: { reason: 'guest called' },
    });
    assert.equal(canceled.status, 200);
    assert.equal(canceled.body.data.status, 'canceled');

    const audit = await api(server, '/api/admin/audit-log', {
      token: owner.token,
    });
    assert.equal(audit.status, 200);
    assert.equal(audit.body.data.length, 3);
    assert.deepEqual(audit.body.data.map(record => record.action), [
      'booking.cancel',
      'booking.create_manual',
      'admin.login',
    ]);
  } finally {
    await server.close();
  }
});

test('owner can create a multi-site manual booking that blocks every selected site', async () => {
  const server = await createTestServer();

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const created = await api(server, '/api/admin/bookings', {
      method: 'POST',
      token: owner.token,
      body: {
        siteIds: ['rv-03', 'rv-11'],
        startDate: '2026-06-04',
        endDate: '2026-06-06',
        guests: 3,
        vehicles: 2,
        customer: { name: 'Phone Group', phone: '555-0109' },
      },
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.data.status, 'confirmed');
    assert.deepEqual(created.body.data.siteIds, ['rv-03', 'rv-11']);
    assert.equal(created.body.data.totalCents, 18000);

    const available = await api(server, '/api/public/bootstrap?startDate=2026-06-04&endDate=2026-06-06');
    assert.equal(available.status, 200);
    assert.equal(available.body.data.rvAvailability.includes('rv-03'), false);
    assert.equal(available.body.data.rvAvailability.includes('rv-11'), false);
  } finally {
    await server.close();
  }
});

test('owner can create an admin Square payment link for a site booking', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  let requestBody = null;
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v2\/online-checkout\/payment-links$/);
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          payment_link: { id: 'plink-admin', url: 'https://square.test/admin-checkout' },
          related_resources: { orders: [{ id: 'order-admin' }] },
        }),
      };
    },
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const checkout = await api(server, '/api/admin/bookings/checkout', {
      method: 'POST',
      token: owner.token,
      body: {
        siteId: 'rv-03',
        startDate: '2026-06-10',
        endDate: '2026-06-12',
        guests: 2,
        vehicles: 1,
        customer: { name: 'Counter Guest', phone: '555-0120', email: 'guest@example.com' },
      },
    });

    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.data.checkout.checkoutUrl, 'https://square.test/admin-checkout');
    assert.equal(checkout.body.data.bookingCode.startsWith('MW-'), true);
    assert.equal(requestBody.order.line_items.length, 1);
    assert.equal(requestBody.order.metadata.booking_code, checkout.body.data.bookingCode);

    const bookings = await api(server, '/api/admin/bookings', { token: owner.token });
    const pending = bookings.body.data.find(booking => booking.bookingCode === checkout.body.data.bookingCode);
    assert.equal(pending.status, 'hold');
    assert.equal(pending.checkoutUrl, 'https://square.test/admin-checkout');
  } finally {
    await server.close();
  }
});

test('owner can create an admin Square payment link for multiple sites', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  let requestBody = null;
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v2\/online-checkout\/payment-links$/);
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          payment_link: { id: 'plink-admin-multi', url: 'https://square.test/admin-checkout-multi' },
          related_resources: { orders: [{ id: 'order-admin-multi' }] },
        }),
      };
    },
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const checkout = await api(server, '/api/admin/bookings/checkout', {
      method: 'POST',
      token: owner.token,
      body: {
        siteIds: ['rv-03', 'rv-11'],
        startDate: '2026-06-20',
        endDate: '2026-06-22',
        guests: 3,
        vehicles: 2,
        customer: { name: 'Counter Group', phone: '555-0122', email: 'group@example.com' },
      },
    });

    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.data.checkout.checkoutUrl, 'https://square.test/admin-checkout-multi');
    assert.deepEqual(checkout.body.data.hold.quote.siteIds, ['rv-03', 'rv-11']);
    assert.equal(checkout.body.data.hold.quote.totalCents, 18000);
    assert.equal(requestBody.order.line_items.length, 3);
    assert.equal(requestBody.order.metadata.rv_site_ids, 'rv-03,rv-11');

    const bookings = await api(server, '/api/admin/bookings', { token: owner.token });
    const pending = bookings.body.data.find(booking => booking.bookingCode === checkout.body.data.bookingCode);
    assert.deepEqual(pending.siteIds, ['rv-03', 'rv-11']);
    assert.equal(pending.checkoutUrl, 'https://square.test/admin-checkout-multi');
  } finally {
    await server.close();
  }
});

test('admin Square payment link fails without a real URL and releases the held site', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const server = await createTestServer({
    store,
    fetchImpl: async (url) => {
      assert.match(url, /\/v2\/online-checkout\/payment-links$/);
      return {
        ok: true,
        json: async () => ({
          payment_link: { id: 'plink-without-url' },
          related_resources: { orders: [{ id: 'order-without-url' }] },
        }),
      };
    },
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const checkout = await api(server, '/api/admin/bookings/checkout', {
      method: 'POST',
      token: owner.token,
      body: {
        siteId: 'rv-04',
        startDate: '2026-06-10',
        endDate: '2026-06-12',
        guests: 2,
        vehicles: 1,
        customer: { name: 'No Link Guest', phone: '555-0121', email: 'no-link@example.com' },
      },
    });

    assert.equal(checkout.status, 409);
    assert.match(checkout.body.error.message, /payment link URL/);

    const bookings = await api(server, '/api/admin/bookings', { token: owner.token });
    assert.equal(bookings.body.data.some(booking => booking.customerName === 'No Link Guest'), false);

    const available = await api(server, '/api/public/bootstrap?startDate=2026-06-10&endDate=2026-06-12');
    assert.equal(available.status, 200);
    assert.equal(available.body.data.rvAvailability.includes('rv-04'), true);
  } finally {
    await server.close();
  }
});

test('employee can read dashboard but cannot create bookings', async () => {
  const server = await createTestServer();

  try {
    const employee = await login(server, 'employee@midway.local', 'employee-pass');
    const dashboard = await api(server, '/api/admin/dashboard/today', {
      token: employee.token,
    });
    assert.equal(dashboard.status, 200);

    const created = await api(server, '/api/admin/bookings', {
      method: 'POST',
      token: employee.token,
      body: {
        siteId: 'rv-03',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        customer: { name: 'Phone Guest', phone: '555-0101' },
      },
    });
    assert.equal(created.status, 404);
    assert.equal(created.body.error.code, 'FEATURE_DISABLED');
  } finally {
    await server.close();
  }
});

test('public web payment confirms a held booking through the payments endpoint', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  let paymentRequest = null;
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      const requestBody = JSON.parse(options.body);
      if (/\/v2\/orders$/.test(url)) {
        return {
          ok: true,
          json: async () => ({
            order: {
              id: 'order-live-test',
              reference_id: requestBody.order.reference_id,
            },
          }),
        };
      }
      assert.match(url, /\/v2\/payments$/);
      paymentRequest = requestBody;
      return {
        ok: true,
        json: async () => ({
          payment: {
            id: 'payment-live-test',
            status: 'COMPLETED',
            order_id: requestBody.order_id,
            amount_money: requestBody.amount_money,
          },
        }),
      };
    },
  });

  try {
    const checkout = await api(server, '/api/bookings/checkout', {
      method: 'POST',
      body: {
        siteId: 'rv-03',
        startDate: '2026-06-20',
        endDate: '2026-06-22',
        guests: 2,
        vehicles: 1,
        customer: { name: 'Card Guest', phone: '555-0103', email: 'card@example.com' },
      },
    });
    assert.equal(checkout.status, 200);
    assert.equal(checkout.body.data.bookingCode.startsWith('MW-'), true);

    const paid = await api(server, '/api/bookings/pay', {
      method: 'POST',
      body: {
        bookingCode: checkout.body.data.bookingCode,
        sourceId: 'cnon:card-nonce-ok',
        verificationToken: 'buyer-verification-token',
        idempotencyKey: 'payment-attempt-123',
      },
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.data.payment.mode, 'square');
    assert.equal(paid.body.data.booking.status, 'confirmed');
    assert.equal(paid.body.data.booking.squarePaymentId, 'payment-live-test');
    assert.equal(paymentRequest.idempotency_key, 'payment-attempt-123');
    assert.equal(paymentRequest.verification_token, 'buyer-verification-token');
  } finally {
    await server.close();
  }
});

test('public checkout supports multiple sites, license upload, extra cars, and Square pay', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const squareRequests = [];
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      const requestBody = JSON.parse(options.body);
      squareRequests.push({ url: String(url), body: requestBody });
      if (/\/v2\/orders$/.test(url)) {
        return {
          ok: true,
          json: async () => ({
            order: {
              id: 'order-multi-site-test',
              reference_id: requestBody.order.reference_id,
            },
          }),
        };
      }
      assert.match(url, /\/v2\/payments$/);
      return {
        ok: true,
        json: async () => ({
          payment: {
            id: 'payment-multi-site-test',
            status: 'COMPLETED',
            order_id: requestBody.order_id,
            amount_money: requestBody.amount_money,
          },
        }),
      };
    },
  });

  try {
    const checkout = await api(server, '/api/bookings/checkout', {
      method: 'POST',
      body: {
        siteIds: ['rv-03', 'rv-11'],
        startDate: '2026-07-13',
        endDate: '2026-07-14',
        guests: 2,
        vehicles: 2,
        customer: { name: 'Multi Guest', phone: '555-0195', email: 'multi@example.com' },
      },
    });
    assert.equal(checkout.status, 200);
    assert.equal(checkout.body.data.hold.quote.totalCents, 9500);
    assert.equal(checkout.body.data.checkout.amountCents, 9500);
    assert.deepEqual(checkout.body.data.hold.quote.siteIds, ['rv-03', 'rv-11']);

    const uploaded = await api(server, `/api/bookings/${checkout.body.data.bookingCode}/driver-license`, {
      method: 'POST',
      body: {
        fileName: 'license.png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      },
    });
    assert.equal(uploaded.status, 200);
    assert.equal(uploaded.body.data.document.contentType, 'image/png');
    assert.equal(uploaded.body.data.document.bookingCode, checkout.body.data.bookingCode);

    const paid = await api(server, '/api/bookings/pay', {
      method: 'POST',
      body: {
        bookingCode: checkout.body.data.bookingCode,
        sourceId: 'cnon:multi-site-card',
        verificationToken: 'multi-site-buyer-token',
        idempotencyKey: 'payment-multi-site-attempt',
      },
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.data.booking.status, 'confirmed');
    assert.deepEqual(paid.body.data.booking.rvSiteIds, ['rv-03', 'rv-11']);
    assert.equal(paid.body.data.booking.totalCents, 9500);

    const payment = squareRequests.find(request => request.url.endsWith('/v2/payments')).body;
    assert.equal(payment.amount_money.amount, 9500);
    assert.equal(payment.idempotency_key, 'payment-multi-site-attempt');
    assert.equal(payment.verification_token, 'multi-site-buyer-token');
  } finally {
    await server.close();
  }
});

test('public Square payment retries use a fresh fallback idempotency key for each card nonce', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const paymentBodies = [];
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      const requestBody = JSON.parse(options.body);
      if (/\/v2\/orders$/.test(url)) {
        return {
          ok: true,
          json: async () => ({
            order: {
              id: `order-${paymentBodies.length}`,
              reference_id: requestBody.order.reference_id,
            },
          }),
        };
      }
      assert.match(url, /\/v2\/payments$/);
      paymentBodies.push(requestBody);
      return {
        ok: true,
        json: async () => ({
          payment: {
            id: `payment-failed-${paymentBodies.length}`,
            status: 'FAILED',
            order_id: requestBody.order_id,
            amount_money: requestBody.amount_money,
          },
        }),
      };
    },
  });

  try {
    const checkout = await api(server, '/api/bookings/checkout', {
      method: 'POST',
      body: {
        siteId: 'rv-06',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        guests: 2,
        vehicles: 1,
        customer: { name: 'Retry Guest', phone: '555-0196', email: 'retry@example.com' },
      },
    });
    assert.equal(checkout.status, 200);

    const first = await api(server, '/api/bookings/pay', {
      method: 'POST',
      body: {
        bookingCode: checkout.body.data.bookingCode,
        sourceId: 'cnon:first-card-token',
      },
    });
    const second = await api(server, '/api/bookings/pay', {
      method: 'POST',
      body: {
        bookingCode: checkout.body.data.bookingCode,
        sourceId: 'cnon:second-card-token',
      },
    });

    assert.equal(first.status, 402);
    assert.equal(second.status, 402);
    assert.equal(paymentBodies.length, 2);
    assert.equal(paymentBodies[0].idempotency_key.length <= 45, true);
    assert.equal(paymentBodies[1].idempotency_key.length <= 45, true);
    assert.notEqual(paymentBodies[0].idempotency_key, paymentBodies[1].idempotency_key);
  } finally {
    await server.close();
  }
});

test('public Square payment accepts old browser idempotency keys over 45 characters', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const squareRequests = [];
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      const requestBody = JSON.parse(options.body);
      squareRequests.push({ url: String(url), body: requestBody });
      if (/\/v2\/orders$/.test(url)) {
        return {
          ok: true,
          json: async () => ({
            order: {
              id: 'order-long-idempotency-test',
              reference_id: requestBody.order.reference_id,
            },
          }),
        };
      }
      assert.match(url, /\/v2\/payments$/);
      return {
        ok: true,
        json: async () => ({
          payment: {
            id: 'payment-long-idempotency-test',
            status: 'COMPLETED',
            order_id: requestBody.order_id,
            amount_money: requestBody.amount_money,
          },
        }),
      };
    },
  });

  try {
    const checkout = await api(server, '/api/bookings/checkout', {
      method: 'POST',
      body: {
        siteId: 'rv-08',
        startDate: '2026-08-03',
        endDate: '2026-08-04',
        guests: 2,
        vehicles: 1,
        customer: { name: 'Long Key Guest', phone: '555-0198', email: 'long-key@example.com' },
      },
    });
    assert.equal(checkout.status, 200);

    const paid = await api(server, '/api/bookings/pay', {
      method: 'POST',
      body: {
        bookingCode: checkout.body.data.bookingCode,
        sourceId: 'cnon:card-nonce-ok',
        idempotencyKey: 'payment-mw-abcd12-apple-pay-12345678-1234-1234-1234-123456789abc',
      },
    });

    assert.equal(paid.status, 200);
    assert.equal(paid.body.data.booking.status, 'confirmed');
    assert.equal(paid.body.data.booking.squarePaymentId, 'payment-long-idempotency-test');
    assert.equal(squareRequests.every(request => request.body.idempotency_key.length <= 45), true);
  } finally {
    await server.close();
  }
});

test('canceling a checkout releases the held site back to availability', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const server = await createTestServer({ store });

  try {
    const checkout = await api(server, '/api/bookings/checkout', {
      method: 'POST',
      body: {
        siteId: 'rv-07',
        startDate: '2026-08-10',
        endDate: '2026-08-11',
        guests: 2,
        vehicles: 1,
        customerSessionId: 'browser-session-7',
        customer: { name: 'Cancel Guest', phone: '555-0197', email: 'cancel@example.com' },
      },
    });
    assert.equal(checkout.status, 200);

    const held = await api(server, '/api/public/bootstrap?startDate=2026-08-10&endDate=2026-08-11');
    assert.equal(held.status, 200);
    assert.equal(held.body.data.rvAvailability.includes('rv-07'), false);

    const released = await api(server, `/api/bookings/holds/${checkout.body.data.hold.id}/release`, {
      method: 'POST',
      body: {
        customerSessionId: 'browser-session-7',
      },
    });
    assert.equal(released.status, 200);
    assert.equal(released.body.data.hold.status, 'released');

    const available = await api(server, '/api/public/bootstrap?startDate=2026-08-10&endDate=2026-08-11');
    assert.equal(available.status, 200);
    assert.equal(available.body.data.rvAvailability.includes('rv-07'), true);

    const booking = await api(server, `/api/bookings/${checkout.body.data.bookingCode}`);
    assert.equal(booking.status, 200);
    assert.equal(booking.body.data.status, 'expired');
  } finally {
    await server.close();
  }
});

test('checkout reads Square and Instagram settings from tenant config', async () => {
  const tenantConfig = createTenantConfig({
    tenantId: 'demo-market',
    locationId: 'main',
    business: {
      publicBrandName: 'Demo Market',
      phone: '(555) 010-4444',
      address: '10 Main St',
      instagramHandle: 'demo_market',
    },
    publicSite: {
      url: 'https://demo.example',
      instagramPosts: ['https://www.instagram.com/p/demo-post/'],
    },
    providers: {
      square: {
        applicationId: 'demo-app',
        locationId: 'demo-location',
        environment: 'sandbox',
      },
    },
  });
  const server = await createTestServer({
    store: createMidwayHarness({ env: baseEnv, tenantConfig }),
  });

  try {
    const bootstrap = await api(server, '/api/public/bootstrap');
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.body.data.settings.businessName, 'Demo Market');
    assert.equal(bootstrap.body.data.settings.phone, '(555) 010-4444');
    assert.equal(bootstrap.body.data.settings.instagramUrl, 'https://www.instagram.com/demo_market/');
    assert.equal(bootstrap.body.data.settings.instagramPosts, undefined);

    const checkout = await api(server, '/api/bookings/checkout', {
      method: 'POST',
      body: {
        siteId: 'rv-03',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
        customer: { name: 'Tenant Guest', phone: '555-0104' },
      },
    });
    assert.equal(checkout.status, 200);
    assert.equal(checkout.body.data.checkout.mode, 'web-payments');
    assert.equal(checkout.body.data.checkout.applicationId, 'demo-app');
    assert.equal(checkout.body.data.checkout.locationId, 'demo-location');
  } finally {
    await server.close();
  }
});

test('Square webhook verifies forwarded production URL and confirms hosted payment bookings', async () => {
  const webhookSignatureKey = 'square-webhook-secret';
  const tenantConfig = createTenantConfig({
    providers: {
      square: {
        status: 'connected',
        accessToken: 'square-token',
        webhookSignatureKey,
        applicationId: 'square-app',
        locationId: 'square-location',
        environment: 'production',
        checkoutSurface: 'payment-link',
      },
    },
  });
  const store = createMidwayHarness({ env: baseEnv, tenantConfig });
  const hold = await store.hold({
    siteId: 'rv-03',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    customerSessionId: 'admin-owner',
  });
  const booking = await store.recordPendingBooking({
    hold,
    customer: { name: 'Webhook Guest', phone: '555-0111' },
    bookingCode: 'MW-WEBHK1',
    squareOrderId: 'order-webhook-1',
    checkoutUrl: 'https://square.test/pay/MW-WEBHK1',
  });
  const server = await createTestServer({ store });

  try {
    assert.equal(booking.status, 'hold');
    const rawBody = JSON.stringify({
      type: 'order.updated',
      event_id: 'evt-webhook-1',
      data: {
        object: {
          order: {
            id: 'order-webhook-1',
            state: 'COMPLETED',
            reference_id: 'MW-WEBHK1',
          },
        },
      },
    });
    const notificationUrl = 'https://www.midwayplain.com/api/square/webhook';
    const signature = crypto.createHmac('sha256', webhookSignatureKey)
      .update(notificationUrl + rawBody)
      .digest('base64');

    const response = await api(server, '/api/square/webhook', {
      method: 'POST',
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'www.midwayplain.com',
        'x-square-hmacsha256-signature': signature,
      },
      rawBody,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.bookingConfirmed, true);
    const confirmed = await api(server, '/api/bookings/MW-WEBHK1');
    assert.equal(confirmed.body.data.status, 'confirmed');
    assert.equal(confirmed.body.data.squareOrderId, 'order-webhook-1');
  } finally {
    await server.close();
  }
});

test('protected admin settings expose editable site fields and sanitized provider status', async () => {
  const tenantConfig = createTenantConfig({
    business: {
      name: 'Midway Test Store',
      publicBrandName: 'Midway Public',
      phone: '(555) 010-2222',
      address: '2 Test Way',
      email: 'hello@example.com',
      instagramHandle: 'midway_test',
    },
    publicSite: {
      url: 'https://midway.example',
      instagramPosts: ['https://www.instagram.com/p/original-post/'],
    },
    providers: {
      square: {
        status: 'connected',
        accessToken: 'square-secret-token',
        webhookSignatureKey: 'square-webhook-secret',
        applicationId: 'sandbox-app',
        locationId: 'plain-location',
        environment: 'sandbox',
      },
      email: {
        status: 'degraded',
        apiKey: 'email-secret-key',
        fromEmail: 'receipts@example.com',
        errorMessage: 'DNS check pending',
      },
      slack: {
        webhookUrl: 'https://hooks.slack.test/secret',
        channel: '#ops',
      },
    },
  });
  const server = await createTestServer({
    store: createMidwayHarness({ env: baseEnv, tenantConfig }),
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const settings = await api(server, '/api/admin/settings', {
      token: owner.token,
    });
    assert.equal(settings.status, 200);
    assert.equal(settings.body.data.business.businessName, 'Midway Test Store');
    assert.deepEqual(settings.body.data.publicSite.instagramPosts, ['https://www.instagram.com/p/original-post/']);

    const square = settings.body.data.providers.find(provider => provider.providerKey === 'square');
    assert.equal(square.status, 'connected');
    assert.equal(square.publicConfig.locationId, 'plain-location');
    assert.equal('accessToken' in square.publicConfig, false);
    assert.equal(JSON.stringify(settings.body.data).includes('square-secret-token'), false);
    assert.equal(JSON.stringify(settings.body.data).includes('square-webhook-secret'), false);

    const slack = settings.body.data.providers.find(provider => provider.providerKey === 'slack');
    assert.equal(slack.status, 'connected');
    assert.deepEqual(slack.publicConfig, { channel: '#ops' });
    assert.equal(JSON.stringify(settings.body.data).includes('hooks.slack.test'), false);

    const instagram = settings.body.data.providers.find(provider => provider.providerKey === 'instagram');
    assert.equal(instagram.status, 'not_connected');
    assert.equal(instagram.publicConfig.handle, 'midway_test');

    const patched = await api(server, '/api/admin/settings', {
      method: 'PATCH',
      token: owner.token,
      body: {
        business: {
          businessName: 'Midway Gas & Grocery',
          publicBrandName: 'Midway Plain',
          phone: '(555) 010-9999',
          address: '99 River Rd',
          email: 'store@example.com',
          timezone: 'America/Los_Angeles',
          instagramHandle: '@midwayplain',
        },
        publicSite: {
          url: 'https://midwayplain.example',
          theme: 'midway_farmhouse',
          instagramPosts: [
            'https://www.instagram.com/p/updated-post/',
            'https://example.com/not-instagram',
          ],
        },
      },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.business.publicBrandName, 'Midway Plain');
    assert.equal(patched.body.data.business.instagramHandle, 'midwayplain');
    assert.deepEqual(patched.body.data.publicSite.instagramPosts, ['https://www.instagram.com/p/updated-post/']);

    const employee = await login(server, 'employee@midway.local', 'employee-pass');
    const denied = await api(server, '/api/admin/settings', {
      method: 'PATCH',
      token: employee.token,
      body: { business: { phone: '(555) 000-0000' } },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'OWNER_PERMISSION_REQUIRED');
  } finally {
    await server.close();
  }
});

test('admin provider status lists business connection state without secrets', async () => {
  const tenantConfig = createTenantConfig({
    business: {
      instagramHandle: 'midwayplain',
    },
    publicSite: {
      instagramPosts: ['https://www.instagram.com/p/provider-post/'],
    },
    providers: {
      square: {
        status: 'connected',
        applicationId: 'sandbox-app',
        locationId: 'sandbox-location',
        environment: 'sandbox',
        accessToken: 'square-secret-token',
      },
      email: {
        status: 'connected',
        webhookUrl: 'https://email.example/secret',
        from: 'Midway <bookings@example.com>',
      },
      slack: {
        status: 'connected',
        webhookUrl: 'https://slack.example/secret',
        channel: '#ops',
      },
    },
  });
  const server = await createTestServer({
    store: createMidwayHarness({ env: baseEnv, tenantConfig }),
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const providers = await api(server, '/api/admin/providers', {
      token: owner.token,
    });

    assert.equal(providers.status, 200);
    const square = providers.body.data.find(provider => provider.providerKey === 'square');
    assert.equal(square.status, 'connected');
    assert.equal(square.publicConfig.locationId, 'sandbox-location');
    assert.equal(square.hasEncryptedCredentials, true);
    const instagram = providers.body.data.find(provider => provider.providerKey === 'instagram');
    assert.equal(instagram.status, 'not_connected');
    assert.equal(instagram.publicConfig.handle, 'midwayplain');
    assert.equal(instagram.publicConfig.postsConfigured, 1);
    assert.equal(JSON.stringify(providers.body.data).includes('square-secret-token'), false);
    assert.equal(JSON.stringify(providers.body.data).includes('email.example/secret'), false);
    assert.equal(JSON.stringify(providers.body.data).includes('slack.example/secret'), false);
  } finally {
    await server.close();
  }
});

test('owner can save and manually refresh Instagram API credentials', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  let refreshRequestedUrl = null;
  const server = await createTestServer({
    store,
    fetchImpl: async (url) => {
      if (String(url).startsWith('https://graph.instagram.com/me?')) {
        return {
          ok: true,
          json: async () => ({
            id: '17841400000000000',
            username: 'midwayplain',
          }),
        };
      }
      refreshRequestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          access_token: 'ig-refreshed-token',
          token_type: 'bearer',
          expires_in: 5184000,
        }),
      };
    },
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const saved = await api(server, '/api/admin/providers/instagram', {
      method: 'PUT',
      token: owner.token,
      body: {
        handle: 'midwayplain',
        profileUrl: 'https://www.instagram.com/midwayplain/',
        instagramUserId: '17841400000000000',
        accessToken: 'ig-original-token',
        tokenExpiresAt: '2026-06-01T00:00:00.000Z',
        feedLimit: 6,
        apiVersion: 'v24.0',
      },
    });

    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.status, 'connected');
    assert.equal(saved.body.data.externalAccountId, '17841400000000000');
    assert.equal(JSON.stringify(saved.body.data).includes('ig-original-token'), false);

    const refreshed = await api(server, '/api/admin/providers/instagram/refresh', {
      method: 'POST',
      token: owner.token,
      body: {},
    });

    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.data.mode, 'refreshed');
    assert.equal(refreshRequestedUrl, 'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=ig-original-token');
    assert.equal(JSON.stringify(refreshed.body.data).includes('ig-refreshed-token'), false);
  } finally {
    await server.close();
  }
});

test('manual Instagram token save discovers user id before refresh', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  const requests = [];
  const server = await createTestServer({
    store,
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).startsWith('https://graph.instagram.com/me?')) {
        return {
          ok: true,
          json: async () => ({
            id: '17841499999999999',
            username: 'midwaygrocer',
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          access_token: 'ig-refreshed-token',
          token_type: 'bearer',
          expires_in: 5184000,
        }),
      };
    },
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const saved = await api(server, '/api/admin/providers/instagram', {
      method: 'PUT',
      token: owner.token,
      body: {
        handle: '',
        profileUrl: 'https://www.instagram.com/midwaygrocer/',
        accessToken: 'ig-manual-token',
        feedLimit: 6,
        apiVersion: 'v24.0',
      },
    });

    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.status, 'connected');
    assert.equal(saved.body.data.externalAccountId, '17841499999999999');
    assert.equal(saved.body.data.publicConfig.handle, 'midwaygrocer');
    assert.equal(requests[0], 'https://graph.instagram.com/me?fields=id%2Cusername&access_token=ig-manual-token');

    const refreshed = await api(server, '/api/admin/providers/instagram/refresh', {
      method: 'POST',
      token: owner.token,
      body: {},
    });

    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.data.mode, 'refreshed');
    assert.equal(requests[1], 'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=ig-manual-token');
    assert.equal(JSON.stringify(saved.body.data).includes('ig-manual-token'), false);
  } finally {
    await server.close();
  }
});

test('Instagram refresh tells owner to connect before token exists', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  const server = await createTestServer({ store });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const refreshed = await api(server, '/api/admin/providers/instagram/refresh', {
      method: 'POST',
      token: owner.token,
      body: {},
    });

    assert.equal(refreshed.status, 400);
    assert.equal(refreshed.body.error.code, 'INSTAGRAM_TOKEN_MISSING');
    assert.match(refreshed.body.error.message, /Connect Instagram/);
  } finally {
    await server.close();
  }
});

test('Instagram OAuth callback stores long-lived API credentials', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  const tokenRequests = [];
  const server = await createTestServer({
    env: baseEnv,
    store,
    platformProviderConfigs: [
      {
        providerKey: 'instagram',
        publicConfig: {
          applicationId: 'instagram-app',
          redirectUri: 'https://www.midwayplain.com/admin.html?provider=instagram',
          apiVersion: 'v24.0',
          apiBaseUrl: 'https://graph.instagram.com',
          feedLimit: 6,
        },
        encryptedCredentials: {
          clientSecret: 'instagram-secret',
        },
      },
    ],
    fetchImpl: async (url, options = {}) => {
      tokenRequests.push({
        url,
        body: options.body ? Object.fromEntries(new URLSearchParams(options.body.toString())) : null,
      });
      if (String(url).includes('/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'ig-short-token',
            user_id: '17841400000000000',
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          access_token: 'ig-long-token',
          token_type: 'bearer',
          expires_in: 5184000,
        }),
      };
    },
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const started = await api(server, '/api/admin/providers/instagram/oauth/start', {
      method: 'POST',
      token: owner.token,
      body: { redirectUri: 'https://midway.example/admin.html?provider=instagram' },
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.data.mode, 'oauth');
    assert.match(started.body.data.authorizationUrl, /^https:\/\/www\.instagram\.com\/oauth\/authorize/);
    assert.equal(started.body.data.redirectUri, 'https://www.midwayplain.com/admin.html?provider=instagram');
    const authorization = new URL(started.body.data.authorizationUrl);
    assert.equal(authorization.searchParams.get('client_id'), 'instagram-app');
    assert.equal(authorization.searchParams.get('redirect_uri'), 'https://www.midwayplain.com/admin.html?provider=instagram');
    assert.equal(authorization.searchParams.get('response_type'), 'code');
    assert.equal(authorization.searchParams.get('scope'), 'instagram_business_basic');
    assert.equal(authorization.searchParams.get('enable_fb_login'), '0');
    assert.equal(authorization.searchParams.get('force_authentication'), '1');
    assert.equal(authorization.searchParams.get('state'), started.body.data.state);

    const completed = await api(server, '/api/admin/providers/instagram/oauth/callback', {
      method: 'POST',
      token: owner.token,
      body: {
        code: 'instagram-auth-code',
        state: started.body.data.state,
        redirectUri: 'https://midway.example/admin.html?provider=instagram',
      },
    });

    assert.equal(completed.status, 200);
    assert.equal(completed.body.data.connection.status, 'connected');
    assert.equal(completed.body.data.connection.externalAccountId, '17841400000000000');
    assert.equal(completed.body.data.connection.hasEncryptedCredentials, true);
    assert.deepEqual(completed.body.data.connection.credentialKeys, ['accessToken']);
    assert.equal(JSON.stringify(completed.body.data).includes('ig-long-token'), false);
    assert.equal(tokenRequests.length, 2);
    assert.equal(tokenRequests[0].body.client_id, 'instagram-app');
    assert.equal(tokenRequests[0].body.client_secret, 'instagram-secret');
    assert.equal(tokenRequests[0].body.redirect_uri, 'https://www.midwayplain.com/admin.html?provider=instagram');
    assert.equal(String(tokenRequests[1].url).startsWith('https://graph.instagram.com/access_token?'), true);
  } finally {
    await server.close();
  }
});

test('cron refreshes Instagram token with cron secret', async () => {
  const env = { ...baseEnv, NODE_ENV: 'production', MIDWAY_CRON_SECRET: 'cron-secret' };
  const store = createMidwayHarness({ env: { ...env, MIDWAY_ALLOW_MEMORY_STORE: 'true' }, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(instagramProviderConnection());
  const server = await createTestServer({
    env,
    store,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        access_token: 'cron-refreshed-token',
        token_type: 'bearer',
        expires_in: 5184000,
      }),
    }),
  });

  try {
    const unauthorized = await api(server, '/api/cron/instagram-refresh', { method: 'POST', body: {} });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${server.url}/api/cron/instagram-refresh`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cron-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force: true }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.mode, 'refreshed');
  } finally {
    await server.close();
  }
});

test('Square OAuth start returns a safe placeholder when platform credentials are absent', async () => {
  const server = await createTestServer();

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const started = await api(server, '/api/admin/providers/square/oauth/start', {
      method: 'POST',
      token: owner.token,
      body: { redirectUri: 'https://midway.example/admin/providers/square/callback' },
    });

    assert.equal(started.status, 202);
    assert.equal(started.body.data.mode, 'placeholder');
    assert.equal(started.body.data.authorizationUrl, null);
    assert.deepEqual(started.body.data.missing, [
      'platform_provider_configs.square.environment',
      'platform_provider_configs.square.public_config.applicationId',
      'platform_provider_configs.square.encrypted_credentials.clientSecret',
    ]);
    assert.equal(started.body.data.connection.status, 'not_connected');
  } finally {
    await server.close();
  }
});

test('Square OAuth callback stores provider credentials behind connection interfaces', async () => {
  const store = createMidwayHarness({
    env: baseEnv,
    tenantConfig: createTenantConfig({
      providers: {
        square: {
          status: 'not_connected',
          environment: 'sandbox',
        },
      },
    }),
  });
  const tokenRequests = [];
  const server = await createTestServer({
    env: baseEnv,
    store,
    platformProviderConfigs: [
      {
        providerKey: 'square',
        environment: 'sandbox',
        publicConfig: {
          applicationId: 'sandbox-app',
          environment: 'sandbox',
        },
        encryptedCredentials: {
          clientSecret: 'sandbox-secret',
        },
      },
    ],
    fetchImpl: async (url, options) => {
      tokenRequests.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({
          access_token: 'oauth-access-token',
          refresh_token: 'oauth-refresh-token',
          token_type: 'bearer',
          expires_at: '2026-06-11T00:00:00Z',
          merchant_id: 'merchant-123',
        }),
      };
    },
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const started = await api(server, '/api/admin/providers/square/oauth/start', {
      method: 'POST',
      token: owner.token,
      body: { redirectUri: 'https://midway.example/admin/providers/square/callback' },
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.data.mode, 'oauth');
    assert.match(started.body.data.authorizationUrl, /^https:\/\/connect\.squareupsandbox\.com\/oauth2\/authorize/);

    const completed = await api(server, '/api/admin/providers/square/oauth/callback', {
      method: 'POST',
      token: owner.token,
      body: {
        code: 'square-auth-code',
        state: started.body.data.state,
        redirectUri: 'https://midway.example/admin/providers/square/callback',
        locationId: 'square-location-1',
      },
    });

    assert.equal(completed.status, 200);
    assert.equal(completed.body.data.connection.status, 'connected');
    assert.equal(completed.body.data.connection.externalAccountId, 'merchant-123');
    assert.equal(completed.body.data.connection.hasEncryptedCredentials, true);
    assert.deepEqual(completed.body.data.connection.credentialKeys, [
      'accessToken',
      'refreshToken',
      'tokenType',
      'expiresAt',
    ]);
    assert.equal(JSON.stringify(completed.body.data).includes('oauth-access-token'), false);
    assert.equal(tokenRequests.length, 1);
    assert.equal(tokenRequests[0].body.client_id, 'sandbox-app');
    assert.equal(tokenRequests[0].body.client_secret, 'sandbox-secret');
  } finally {
    await server.close();
  }
});

test('owner can refund a booking with audit metadata when refunds are enabled', async () => {
  const env = {
    ...baseEnv,
    FEATURE_FLAGS_JSON: JSON.stringify({ 'payments.refunds': true }),
  };
  const store = createMidwayHarness({ env, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const server = await createTestServer({
    env,
    store,
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v2\/refunds$/);
      const requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          refund: {
            id: 'refund-live-test',
            status: 'COMPLETED',
            payment_id: requestBody.payment_id,
            amount_money: requestBody.amount_money,
          },
        }),
      };
    },
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const created = await api(server, '/api/admin/bookings', {
      method: 'POST',
      token: owner.token,
      body: {
        siteId: 'rv-03',
        startDate: '2026-06-10',
        endDate: '2026-06-12',
        customer: { name: 'Refund Guest', phone: '555-0102' },
      },
    });
    assert.equal(created.status, 201);
    await store.confirmBooking({
      bookingCode: created.body.data.bookingCode,
      squarePaymentId: 'payment-live-test',
      source: 'square-web-payments',
    });

    const refunded = await api(server, `/api/admin/bookings/${created.body.data.bookingCode}/refund`, {
      method: 'POST',
      token: owner.token,
      body: { reason: 'Guest canceled before arrival' },
    });
    assert.equal(refunded.status, 200);
    assert.equal(refunded.body.data.refund.mode, 'square');
    assert.equal(refunded.body.data.refund.refundId, 'refund-live-test');
    assert.equal(refunded.body.data.booking.status, 'refunded');
    assert.equal(refunded.body.data.booking.refundAmountCents, created.body.data.totalCents);

    const audit = await api(server, '/api/admin/audit-log', {
      token: owner.token,
    });
    assert.equal(audit.status, 200);
    assert.equal(audit.body.data[0].action, 'payment.refund');
    assert.equal(audit.body.data[0].metadata.reason, 'Guest canceled before arrival');
    assert.equal(audit.body.data[0].metadata.providerMode, 'square');
  } finally {
    await server.close();
  }
});

test('refund endpoint denies employees and disabled refund flag', async () => {
  const employeeServer = await createTestServer({
    env: {
      ...baseEnv,
      FEATURE_FLAGS_JSON: JSON.stringify({ 'payments.refunds': true }),
    },
  });
  try {
    const employee = await login(employeeServer, 'employee@midway.local', 'employee-pass');
    const response = await api(employeeServer, '/api/admin/bookings/MW-NOPE/refund', {
      method: 'POST',
      token: employee.token,
      body: { reason: 'should be denied' },
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'FEATURE_DISABLED');
  } finally {
    await employeeServer.close();
  }

  const disabledFlagServer = await createTestServer();
  try {
    const owner = await login(disabledFlagServer, 'owner@midway.local', 'owner-pass');
    const response = await api(disabledFlagServer, '/api/admin/bookings/MW-NOPE/refund', {
      method: 'POST',
      token: owner.token,
      body: { reason: 'should be denied' },
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'FEATURE_DISABLED');
  } finally {
    await disabledFlagServer.close();
  }
});

test('owner can edit RV site details and Square mapping with audit log', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertStoreInventory([
    {
      squareItemId: 'ITEM_RV',
      squareVariationId: 'VAR_RV_03',
      sku: 'RV-03-SQUARE',
      name: 'RV Site 03 Night',
      priceCents: 6100,
      category: 'RV Sites',
      active: true,
      hidden: false,
    },
  ]);
  const server = await createTestServer({ store });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const patched = await api(server, '/api/admin/rv-sites/rv-03', {
      method: 'PATCH',
      token: owner.token,
      body: {
        displayName: 'Premium Site 03',
        status: 'maintenance',
        nightlyPriceCents: 6100,
        maxRvLengthFeet: 42,
        amp: '50A',
        type: 'back',
        shade: 'partial',
        sku: 'RV-03-SQUARE',
        squareCatalogObjectId: 'VAR_RV_03',
        customerNotes: 'Best for larger rigs.',
        adminNotes: 'Verify pedestal after repair.',
        amenities: ['Water', 'Septic', 'Big rig'],
        mapX: 900,
      },
    });

    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.displayName, 'Premium Site 03');
    assert.equal(patched.body.data.status, 'maintenance');
    assert.equal(patched.body.data.squareCatalogObjectId, 'VAR_RV_03');
    assert.deepEqual(patched.body.data.amenities, ['Water', 'Septic', 'Big rig']);

    const audit = await api(server, '/api/admin/audit-log', { token: owner.token });
    assert.equal(audit.body.data[0].action, 'rv_site.update_details');
    assert.equal(audit.body.data[0].targetId, 'rv-03');
    assert.equal(audit.body.data[0].metadata.fields.includes('squareCatalogObjectId'), true);
  } finally {
    await server.close();
  }
});

test('Square catalog sync persists variations and bootstrap prefers persisted products', async () => {
  const env = {
    ...baseEnv,
    FEATURE_FLAGS_JSON: JSON.stringify({ 'inventory.cache': true }),
  };
  const store = createMidwayHarness({ env, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const server = await createTestServer({
    env,
    store,
    fetchImpl: async (url) => {
      assert.match(url, /\/v2\/catalog\/list\?types=ITEM$/);
      return {
        ok: true,
        json: async () => ({
          objects: [
            {
              id: 'ITEM_FIREWOOD',
              updated_at: '2026-05-01T00:00:00Z',
              item_data: {
                name: 'Firewood Bundle',
                description: 'Local bundle',
                categories: [{ name: 'Camping' }],
                variations: [
                  {
                    id: 'VAR_FIREWOOD',
                    item_variation_data: {
                      sku: 'FIREWOOD',
                      price_money: { amount: 800, currency: 'USD' },
                    },
                  },
                ],
              },
            },
          ],
        }),
      };
    },
  });

  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const synced = await api(server, '/api/admin/square/catalog/sync', {
      method: 'POST',
      token: owner.token,
      body: {},
    });
    assert.equal(synced.status, 200);
    assert.equal(synced.body.data[0].squareVariationId, 'VAR_FIREWOOD');

    const listed = await api(server, '/api/admin/square/catalog', { token: owner.token });
    assert.equal(listed.body.data.length, 1);
    assert.equal(listed.body.data[0].sku, 'FIREWOOD');

    const bootstrap = await api(server, '/api/public/bootstrap');
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.body.data.products[0].variationId, 'VAR_FIREWOOD');
    assert.equal(bootstrap.body.data.featureFlags.products, true);
  } finally {
    await server.close();
  }
});

test('mapped RV site checkout sends Square catalog variation line item', async () => {
  const tenantConfig = createTenantConfig({
    providers: {
      square: {
        status: 'connected',
        locationId: 'sandbox-local-location',
        environment: 'sandbox',
        checkoutSurface: 'payment-link',
      },
    },
  });
  const store = createMidwayHarness({ env: baseEnv, tenantConfig });
  await store.upsertProviderConnection({
    ...squareProviderConnection(),
    publicConfig: {
      locationId: 'sandbox-local-location',
      environment: 'sandbox',
      checkoutSurface: 'payment-link',
    },
  });
  await store.updateSiteDetails({
    siteId: 'rv-03',
    patch: {
      squareCatalogObjectId: 'VAR_RV_03',
      sku: 'RV-03-SQUARE',
    },
  });
  let requestBody;
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v2\/online-checkout\/payment-links$/);
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          payment_link: { id: 'plink', url: 'https://square.test/checkout' },
          related_resources: { orders: [{ id: 'order-123' }] },
        }),
      };
    },
  });

  try {
    const checkout = await api(server, '/api/bookings/checkout', {
      method: 'POST',
      body: {
        siteId: 'rv-03',
        startDate: '2026-08-01',
        endDate: '2026-08-03',
        customer: { name: 'Mapped Guest', phone: '555-0105' },
      },
    });
    assert.equal(checkout.status, 200);
    assert.equal(requestBody.order.line_items[0].catalog_object_id, 'VAR_RV_03');
    assert.equal(requestBody.order.line_items[0].metadata.sku, 'RV-03-SQUARE');
  } finally {
    await server.close();
  }
});

async function createTestServer({
  env = baseEnv,
  store = createMidwayHarness({ env, tenantConfig: createTestTenantConfig() }),
  fetchImpl,
  platformProviderConfigs,
} = {}) {
  const app = express();
  app.use(express.json({
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString('utf8');
    },
  }));
  app.use('/api', createApiRouter({
    env,
    store,
    fetchImpl,
    platformProviderConfigs,
  }));

  const listener = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const { port } = listener.address();

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => listener.close(resolve)),
  };
}

function createTestTenantConfig() {
  return createTenantConfig({
    tenantId: 'midway',
    locationId: 'plain',
    business: {
      name: 'Midway Gas & Grocery',
      publicBrandName: 'Midway Gas & Grocery',
      phone: '(206) 669-5880',
      address: '14193 Chiwawa Loop RD, Leavenworth, WA 98826',
      timezone: 'America/Los_Angeles',
      instagramHandle: 'midwayplain',
    },
    publicSite: {
      theme: 'midway_farmhouse',
      instagramPosts: [],
    },
    providers: {
      square: {
        status: 'connected',
        applicationId: 'sandbox-local-app',
        locationId: 'sandbox-local-location',
        environment: 'sandbox',
      },
    },
  });
}

function squareProviderConnection() {
  return {
    tenantId: 'midway',
    locationId: 'plain',
    providerKey: 'square',
    providerKind: 'payment',
    status: 'connected',
    publicConfig: {
      applicationId: 'sandbox-local-app',
      locationId: 'sandbox-local-location',
      environment: 'sandbox',
    },
    encryptedCredentials: {
      accessToken: 'sandbox-access-token',
    },
  };
}

function instagramProviderConnection() {
  return {
    tenantId: 'midway',
    locationId: 'plain',
    providerKey: 'instagram',
    providerKind: 'social',
    status: 'connected',
    publicConfig: {
      handle: 'midwayplain',
      profileUrl: 'https://www.instagram.com/midwayplain/',
      feedSource: 'Instagram Graph API',
      feedLimit: 6,
      apiVersion: 'v24.0',
      tokenExpiresAt: '2026-06-01T00:00:00.000Z',
    },
    encryptedCredentials: {
      accessToken: 'ig-original-token',
    },
    externalAccountId: '17841400000000000',
  };
}

async function api(server, path, { method = 'GET', token, body, headers = {}, rawBody } = {}) {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body || rawBody ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: rawBody ?? (body ? JSON.stringify(body) : undefined),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function login(server, email, password) {
  const response = await api(server, '/api/admin/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.email, email);
  return response.body.data;
}

// ─── helpers for edit/cancel tests ──────────────────────────────────────────

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function createConfirmedBooking(server, token, overrides = {}) {
  const created = await api(server, '/api/admin/bookings', {
    method: 'POST',
    token,
    body: {
      siteId: 'rv-03',
      startDate: daysFromNow(40),
      endDate: daysFromNow(43),
      customer: { name: 'Edit Guest', phone: '(555) 010-9900', email: 'editguest@example.com' },
      ...overrides,
    },
  });
  assert.equal(created.status, 201);
  return created.body.data;
}

// ─── admin booking lookup ────────────────────────────────────────────────────

test('admin can look up bookings by phone number', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    await createConfirmedBooking(server, owner.token);
    const result = await api(server, '/api/admin/bookings/lookup?q=010-9900', { token: owner.token });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length >= 1, true);
    assert.equal(result.body.data.every(b => b.customerPhone?.includes('010-9900') || b.customerName?.includes('Edit')), true);
  } finally {
    await server.close();
  }
});

test('admin can look up bookings by email', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    await createConfirmedBooking(server, owner.token);
    const result = await api(server, '/api/admin/bookings/lookup?q=editguest@example.com', { token: owner.token });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length >= 1, true);
  } finally {
    await server.close();
  }
});

test('admin can look up bookings by name', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    await createConfirmedBooking(server, owner.token);
    const result = await api(server, '/api/admin/bookings/lookup?q=Edit+Guest', { token: owner.token });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length >= 1, true);
  } finally {
    await server.close();
  }
});

test('admin lookup returns empty array when nothing matches', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const result = await api(server, '/api/admin/bookings/lookup?q=nobody999@nowhere.invalid', { token: owner.token });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, []);
  } finally {
    await server.close();
  }
});

// ─── admin edit booking ──────────────────────────────────────────────────────

test('admin can edit a booking with no price change', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await createConfirmedBooking(server, owner.token);
    const newStart = daysFromNow(50);
    const newEnd = daysFromNow(53);
    const result = await api(server, `/api/admin/bookings/${booking.bookingCode}`, {
      method: 'PATCH',
      token: owner.token,
      body: { startDate: newStart, endDate: newEnd },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.booking.startDate, newStart);
    assert.equal(result.body.data.booking.endDate, newEnd);
    assert.equal(result.body.data.diffCents, 0);
  } finally {
    await server.close();
  }
});

test('admin edit returns 402 with checkout config when price increases and no payment token', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const server = await createTestServer({ store });
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await createConfirmedBooking(server, owner.token);
    const result = await api(server, `/api/admin/bookings/${booking.bookingCode}`, {
      method: 'PATCH',
      token: owner.token,
      body: { startDate: daysFromNow(50), endDate: daysFromNow(55) },
    });
    assert.equal(result.status, 402);
    assert.equal(result.body.data.diffCents > 0, true);
    assert.equal(result.body.data.checkoutConfig.mode, 'web-payments');
    assert.equal(typeof result.body.data.checkoutConfig.applicationId, 'string');
  } finally {
    await server.close();
  }
});

test('admin edit charges supplemental payment when price increases and sourceId provided', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const squareBodies = [];
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      squareBodies.push({ url: String(url), body });
      if (/\/v2\/orders$/.test(url)) {
        return { ok: true, json: async () => ({ order: { id: 'order-supplement-test' } }) };
      }
      return {
        ok: true,
        json: async () => ({
          payment: {
            id: 'payment-supplement-test',
            status: 'COMPLETED',
            order_id: 'order-supplement-test',
            amount_money: body.amount_money,
          },
        }),
      };
    },
  });
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await createConfirmedBooking(server, owner.token);
    const result = await api(server, `/api/admin/bookings/${booking.bookingCode}`, {
      method: 'PATCH',
      token: owner.token,
      body: {
        startDate: daysFromNow(50),
        endDate: daysFromNow(55),
        sourceId: 'cnon:card-nonce-ok',
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.booking.nights, 5);
    assert.equal(result.body.data.diffCents > 0, true);
    assert.equal(squareBodies.some(r => /\/v2\/payments$/.test(r.url)), true);
  } finally {
    await server.close();
  }
});

test('admin edit does not change booking when supplemental payment fails', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const server = await createTestServer({
    store,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        payment: {
          id: 'payment-declined-test',
          status: 'FAILED',
          amount_money: { amount: 8800, currency: 'USD' },
        },
      }),
    }),
  });
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await createConfirmedBooking(server, owner.token);
    const result = await api(server, `/api/admin/bookings/${booking.bookingCode}`, {
      method: 'PATCH',
      token: owner.token,
      body: {
        startDate: daysFromNow(50),
        endDate: daysFromNow(55),
        sourceId: 'cnon:card-nonce-fail',
      },
    });
    assert.equal(result.status, 402);
    const unchanged = await store.getBooking(booking.bookingCode);
    assert.equal(unchanged.startDate, booking.startDate);
    assert.equal(unchanged.endDate, booking.endDate);
    assert.equal(unchanged.nights, booking.nights);
  } finally {
    await server.close();
  }
});

test('admin edit issues Square refund when price decreases', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const squareBodies = [];
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      squareBodies.push({ url: String(url), body });
      return {
        ok: true,
        json: async () => ({
          refund: { id: 'refund-edit-test', status: 'COMPLETED', payment_id: body.payment_id, amount_money: body.amount_money },
        }),
      };
    },
  });
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await createConfirmedBooking(server, owner.token);
    await store.confirmBooking({
      bookingCode: booking.bookingCode,
      squarePaymentId: 'payment-edit-refund-test',
      source: 'square-web-payments',
    });
    const result = await api(server, `/api/admin/bookings/${booking.bookingCode}`, {
      method: 'PATCH',
      token: owner.token,
      body: { endDate: daysFromNow(42) },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.diffCents < 0, true);
    assert.equal(squareBodies.some(r => /\/v2\/refunds$/.test(r.url)), true);
    assert.equal(squareBodies[0].body.payment_id, 'payment-edit-refund-test');
    assert.equal(squareBodies[0].body.amount_money.amount, Math.abs(result.body.data.diffCents));
  } finally {
    await server.close();
  }
});

// ─── public booking lookup ───────────────────────────────────────────────────

test('public lookup returns bookings when phone and email match', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await createConfirmedBooking(server, owner.token);
    const result = await api(server, '/api/bookings/lookup', {
      method: 'POST',
      body: { phone: '(555) 010-9900', email: 'editguest@example.com' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length >= 1, true);
    assert.equal(result.body.data[0].bookingCode, booking.bookingCode);
  } finally {
    await server.close();
  }
});

test('public lookup returns empty when email does not match', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    await createConfirmedBooking(server, owner.token);
    const result = await api(server, '/api/bookings/lookup', {
      method: 'POST',
      body: { phone: '(555) 010-9900', email: 'wrong@example.com' },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, []);
  } finally {
    await server.close();
  }
});

// ─── public self-service edit ────────────────────────────────────────────────

test('customer can self-service edit a booking with no price change', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await createConfirmedBooking(server, owner.token);
    const newStart = daysFromNow(50);
    const newEnd = daysFromNow(53);
    const result = await api(server, `/api/bookings/${booking.bookingCode}/edit`, {
      method: 'POST',
      body: {
        phone: '(555) 010-9900',
        email: 'editguest@example.com',
        startDate: newStart,
        endDate: newEnd,
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.booking.startDate, newStart);
    assert.equal(result.body.data.diffCents, 0);
  } finally {
    await server.close();
  }
});

test('customer edit returns 402 with checkout config when price increases and no sourceId', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const server = await createTestServer({ store });
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await createConfirmedBooking(server, owner.token);
    const result = await api(server, `/api/bookings/${booking.bookingCode}/edit`, {
      method: 'POST',
      body: {
        phone: '(555) 010-9900',
        email: 'editguest@example.com',
        startDate: daysFromNow(50),
        endDate: daysFromNow(55),
      },
    });
    assert.equal(result.status, 402);
    assert.equal(result.body.data.diffCents > 0, true);
    assert.equal(result.body.data.checkoutConfig.mode, 'web-payments');
  } finally {
    await server.close();
  }
});

test('customer edit rejects mismatched phone or email', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await createConfirmedBooking(server, owner.token);
    const result = await api(server, `/api/bookings/${booking.bookingCode}/edit`, {
      method: 'POST',
      body: {
        phone: '(555) 010-9900',
        email: 'impostor@example.com',
        startDate: daysFromNow(50),
        endDate: daysFromNow(53),
      },
    });
    assert.equal(result.status, 403);
  } finally {
    await server.close();
  }
});

// ─── public self-service cancel ──────────────────────────────────────────────

test('customer can cancel within no-refund window with no Square call', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await api(server, '/api/admin/bookings', {
      method: 'POST',
      token: owner.token,
      body: {
        siteId: 'rv-04',
        startDate: daysFromNow(5),
        endDate: daysFromNow(8),
        customer: { name: 'No Refund Guest', phone: '(555) 010-7700', email: 'norefund@example.com' },
      },
    });
    assert.equal(booking.status, 201);
    const result = await api(server, `/api/bookings/${booking.body.data.bookingCode}/cancel`, {
      method: 'POST',
      body: { phone: '(555) 010-7700', email: 'norefund@example.com' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.booking.status, 'canceled');
    assert.equal(result.body.data.refundCents, 0);
    assert.equal(result.body.data.policyTier, 'none');
  } finally {
    await server.close();
  }
});

test('customer cancel issues full Square refund when 30+ days before arrival', async () => {
  const store = createMidwayHarness({ env: baseEnv, tenantConfig: createTestTenantConfig() });
  await store.upsertProviderConnection(squareProviderConnection());
  const squareBodies = [];
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      squareBodies.push({ url: String(url), body });
      return {
        ok: true,
        json: async () => ({
          refund: { id: 'refund-cancel-test', status: 'COMPLETED', payment_id: body.payment_id, amount_money: body.amount_money },
        }),
      };
    },
  });
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const created = await api(server, '/api/admin/bookings', {
      method: 'POST',
      token: owner.token,
      body: {
        siteId: 'rv-05',
        startDate: daysFromNow(45),
        endDate: daysFromNow(48),
        customer: { name: 'Full Refund Guest', phone: '(555) 010-8800', email: 'fullrefund@example.com' },
      },
    });
    assert.equal(created.status, 201);
    await store.confirmBooking({
      bookingCode: created.body.data.bookingCode,
      squarePaymentId: 'payment-cancel-test',
      source: 'square-web-payments',
    });

    const result = await api(server, `/api/bookings/${created.body.data.bookingCode}/cancel`, {
      method: 'POST',
      body: { phone: '(555) 010-8800', email: 'fullrefund@example.com' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.booking.status, 'canceled');
    assert.equal(result.body.data.policyTier, 'full');
    assert.equal(result.body.data.refundCents, created.body.data.totalCents);
    assert.equal(squareBodies.some(r => /\/v2\/refunds$/.test(r.url)), true);
  } finally {
    await server.close();
  }
});

test('customer cancel rejects mismatched credentials', async () => {
  const server = await createTestServer();
  try {
    const owner = await login(server, 'owner@midway.local', 'owner-pass');
    const booking = await createConfirmedBooking(server, owner.token);
    const result = await api(server, `/api/bookings/${booking.bookingCode}/cancel`, {
      method: 'POST',
      body: { phone: '(555) 010-9900', email: 'wrong@example.com' },
    });
    assert.equal(result.status, 403);
  } finally {
    await server.close();
  }
});
