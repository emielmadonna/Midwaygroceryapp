import test from 'node:test';
import assert from 'node:assert/strict';
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
  const server = await createTestServer({
    store,
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v2\/payments$/);
      const requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          payment: {
            id: 'payment-live-test',
            status: 'COMPLETED',
            order_id: requestBody.idempotency_key,
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
      },
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.data.payment.mode, 'square');
    assert.equal(paid.body.data.booking.status, 'confirmed');
    assert.equal(paid.body.data.booking.squarePaymentId, 'payment-live-test');
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
    assert.deepEqual(bootstrap.body.data.settings.instagramPosts, ['https://www.instagram.com/p/demo-post/']);

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
    assert.equal(instagram.status, 'connected');
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
    assert.equal(instagram.status, 'connected');
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

async function api(server, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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
