import test from 'node:test';
import assert from 'node:assert/strict';

import { createMidwayHarness } from '../src/lib/midway-harness.js';
import { createNotificationService } from '../src/lib/notifications.js';
import { createTenantConfig } from '../src/lib/tenant-config.js';

test('booking confirmation queues customer and dashboard notifications', async () => {
  const store = createMidwayHarness({
    env: { NODE_ENV: 'test' },
    tenantConfig: createTenantConfig({ tenantId: 'midway', locationId: 'plain' }),
  });
  const notifications = createNotificationService({ store });

  await notifications.bookingConfirmed({
    bookingCode: 'MW-NOTIFY',
    rvSiteId: 'rv-01',
    customerName: 'Guest One',
    customerEmail: 'guest@example.com',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    nights: 2,
  });

  const recorded = await store.listNotifications();

  assert.equal(recorded.length, 2);
  assert.deepEqual(recorded.map(notification => notification.type), [
    'customer.booking_confirmed',
    'admin.booking_confirmed',
  ]);
  assert.deepEqual(recorded.map(notification => notification.status), ['queued', 'queued']);
});

test('booking confirmation sends through configured messaging providers', async () => {
  const requests = [];
  const store = createMidwayHarness({
    env: { NODE_ENV: 'test' },
    tenantConfig: createTenantConfig({
      providers: {
        email: {
          bookingWebhookUrl: 'https://email.example/send',
          from: 'Demo <bookings@example.com>',
        },
        slack: {
          webhookUrl: 'https://slack.example/hook',
        },
      },
    }),
  });
  const notifications = createNotificationService({
    store,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true };
    },
  });

  await notifications.bookingConfirmed({
    bookingCode: 'MW-SENT',
    rvSiteId: 'rv-01',
    customerName: 'Guest Two',
    customerEmail: 'guest2@example.com',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    nights: 2,
  });

  const recorded = await store.listNotifications();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://email.example/send');
  assert.equal(requests[0].body.from, 'Demo <bookings@example.com>');
  assert.equal(requests[1].url, 'https://slack.example/hook');
  assert.deepEqual(recorded.map(notification => notification.status), ['sent', 'sent', 'queued']);
});

test('booking confirmation ignores email and slack endpoints from env when provider connections are missing', async () => {
  const requests = [];
  const env = {
    NODE_ENV: 'test',
    BOOKING_EMAIL_WEBHOOK_URL: 'https://env-email.example/send',
    BOOKING_EMAIL_FROM: 'Env <env@example.com>',
    SLACK_WEBHOOK_URL: 'https://env-slack.example/hook',
    ADMIN_SLACK_WEBHOOK_URL: 'https://env-admin-slack.example/hook',
  };
  const store = createMidwayHarness({
    env,
    tenantConfig: createTenantConfig({
      providers: {
        square: {
          status: 'connected',
          applicationId: 'sandbox-app',
          locationId: 'sandbox-location',
          environment: 'sandbox',
        },
      },
    }),
  });
  const notifications = createNotificationService({
    store,
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true };
    },
  });

  await notifications.bookingConfirmed({
    bookingCode: 'MW-NO-ENV',
    rvSiteId: 'rv-01',
    customerName: 'Guest Env',
    customerEmail: 'env-guest@example.com',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    nights: 2,
  });

  const recorded = await store.listNotifications();
  assert.deepEqual(requests, []);
  assert.deepEqual(recorded.map(notification => notification.type), [
    'customer.booking_confirmed',
    'admin.booking_confirmed',
  ]);
  assert.deepEqual(recorded.map(notification => notification.status), ['queued', 'queued']);
});
