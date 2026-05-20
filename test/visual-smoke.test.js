import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { createApiRouter } from '../src/api/routes.js';
import { createMidwayHarness } from '../src/lib/midway-harness.js';
import { createTenantConfig } from '../src/lib/tenant-config.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const env = {
  NODE_ENV: 'test',
  ADMIN_OWNER_EMAIL: 'owner@midway.local',
  ADMIN_OWNER_PASSWORD: 'owner-pass',
  ADMIN_EMPLOYEE_EMAIL: 'employee@midway.local',
  ADMIN_EMPLOYEE_PASSWORD: 'employee-pass',
  ADMIN_SESSION_SECRET: 'visual-smoke-session-secret',
  FEATURE_FLAGS_JSON: JSON.stringify({
    'public.section.instagram': true,
    'booking.admin_calendar': true,
    'booking.admin_property_map': true,
    'payments.refunds': true,
    'admin.employee_mode': true,
  }),
};

test('public page keeps responsive shell, assets, and Instagram embed contract', async () => {
  const [indexHtml, appJsx, styles] = await Promise.all([
    readProjectFile('index.html'),
    readProjectFile('src/midway.jsx'),
    readProjectFile('styles.css'),
  ]);

  assert.match(indexHtml, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1"/);
  assert.match(indexHtml, /<div\s+id="root"><\/div>/);
  assert.match(indexHtml, /href="\/styles\.css"/);
  assert.match(indexHtml, /type="module"\s+src="\/src\/midway\.jsx"/);
  assert.doesNotMatch(indexHtml, /babel\.min\.js|text\/babel|react\.development\.js|react-dom\.development\.js/);

  assert.match(appJsx, /\/public\/bootstrap/);
  assert.match(appJsx, /const Instagram = \(\{ settings = \{\} \}\) =>/);
  assert.match(appJsx, /id="instagram"/);
  assert.doesNotMatch(appJsx, /title="Midway Instagram profile"/);
  assert.doesNotMatch(appJsx, /\/embed\/captioned/);
  assert.match(appJsx, /settings\.instagramFeed/);
  assert.match(appJsx, /className="instagram-gallery"/);
  assert.doesNotMatch(appJsx, /className="instagram-fallback"/);
  assert.match(appJsx, /visibleSections\.instagram && <Instagram/);
  assert.match(appJsx, /https:\/\/sandbox\.web\.squarecdn\.com\/v1\/square\.js/);
  assert.match(appJsx, /const SquarePaymentForm = \(\{ session, onPay, onSuccess, onCancel \}\) =>/);
  assert.match(appJsx, /\/bookings\/pay/);
  assert.doesNotMatch(appJsx, /synthetic-card-token|DEFAULT_SITES|RESERVATION_KEY/);

  await assertAssetExists('src/midway.jsx');
  await assertAssetExists('public/images/exterior-detailed.jpg');
  await assertAssetExists('public/assets/midway-logo.png');

  assert.match(styles, /body\s*\{[\s\S]*overflow-x:\s*hidden;/);
  assert.match(styles, /\.instagram-gallery\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.instagram-card\s*\{[\s\S]*grid-template-rows:\s*auto 1fr;/);
  assert.match(styles, /\.square-card-host\s*\{[\s\S]*min-height:\s*96px;/);
  assert.match(styles, /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*\.nav-links\s*\{\s*display:\s*none;/);
  assert.match(styles, /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*\.instagram-gallery\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*\.nav-actions\s*\{\s*display:\s*flex;\s*gap:\s*8px;/);
  assert.match(styles, /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*\.nav-action\s*\{\s*display:\s*none;/);
  assert.match(styles, /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*\.nav-brand-sub\s*\{\s*display:\s*none;/);
  assert.match(styles, /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*\.hero-actions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*1fr;/);
  assert.match(styles, /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*\.instagram-gallery,[\s\S]*\.book-form \.row2/);
});

test('admin page keeps login shell, session flow, and mobile guardrails', async () => {
  const [adminHtml, adminJs, adminCss] = await Promise.all([
    readProjectFile('admin.html'),
    readProjectFile('src/admin.js'),
    readProjectFile('src/styles/admin.css'),
  ]);

  assert.match(adminHtml, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1\.0"/);
  assert.match(adminHtml, /<form\s+id="loginForm"/);
  assert.match(adminHtml, /type="email"\s+id="loginEmail"/);
  assert.match(adminHtml, /type="password"\s+id="loginPassword"/);
  assert.match(adminHtml, /id="loginStatus"/);
  assert.match(adminHtml, /id="adminDashboard"\s+hidden/);
  assert.match(adminHtml, /id="settingsPanel"/);
  assert.match(adminHtml, /id="businessSettingsForm"/);
  assert.doesNotMatch(adminHtml, /name="instagramPosts"/);
  assert.match(adminHtml, /id="providerStatusGrid"/);
  assert.match(adminHtml, /type="module"\s+src="\/src\/admin\.js"/);

  assert.match(adminJs, /\/api\/admin\/auth\/login/);
  assert.match(adminJs, /sessionStorage\.setItem\(tokenKey,\s*session\.token\)/);
  assert.match(adminJs, /Authorization:\s*`Bearer \$\{state\.token\}`/);
  assert.match(adminJs, /\/api\/admin\/me/);
  assert.match(adminJs, /document\.body\.dataset\.role/);
  assert.match(adminJs, /document\.body\.dataset\.manualBooking/);
  assert.match(adminJs, /document\.body\.dataset\.siteStatus/);
  assert.match(adminJs, /\/api\/admin\/settings/);
  assert.match(adminJs, /\/api\/admin\/providers/);
  assert.match(adminJs, /\/api\/admin\/providers\/square\/oauth\/start/);
  assert.match(adminJs, /\/api\/admin\/providers\/square\/oauth\/callback/);
  assert.match(adminJs, /data-provider-action="square-oauth"/);
  assert.match(adminJs, /method:\s*'PATCH'/);
  assert.match(adminJs, /document\.body\.dataset\.tenantConfig/);
  assert.match(adminJs, /document\.body\.dataset\.dynamicSections/);
  assert.match(adminJs, /document\.body\.dataset\.providerAdapters/);
  assert.match(adminJs, /state\.user\?\.role !== 'owner'/);
  assert.match(adminJs, /secret\|token\|password\|key\|credential/i);
  assert.match(adminJs, /\/api\/admin\/bookings\/\$\{encodeURIComponent\(bookingCode\)\}\/refund/);
  assert.match(adminJs, /featureEnabled\('payments\.refunds',\s*'refunds'\)/);

  assert.match(adminCss, /\.admin-main\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(adminCss, /\.settings-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(adminCss, /\.provider-status-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(adminCss, /body\[data-role="employee"\]\s+\.owner-only\s*\{[\s\S]*display:\s*none;/);
  assert.match(adminCss, /body\[data-manual-booking="off"\]\s+\.manual-booking-panel\s*\{[\s\S]*display:\s*none;/);
  assert.match(adminCss, /body\[data-tenant-config="off"\]\s+\.feature-tenant-config/);
  assert.match(adminCss, /body\[data-dynamic-sections="off"\]\s+\.feature-dynamic-sections/);
  assert.match(adminCss, /body\[data-provider-adapters="off"\]\s+\.feature-provider-adapters/);
  assert.match(adminCss, /@media\s*\(max-width:\s*980px\)\s*\{[\s\S]*\.admin-main,[\s\S]*\.admin-columns,[\s\S]*\.calendar-layout,[\s\S]*\.property-map-layout\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
  assert.match(adminCss, /@media\s*\(max-width:\s*560px\)\s*\{[\s\S]*\.admin-stats,[\s\S]*\.admin-form__row,[\s\S]*\.settings-grid,[\s\S]*\.employee-task-grid,[\s\S]*\.site-inspector__facts\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
  assert.match(adminCss, /@media\s*\(max-width:\s*560px\)\s*\{[\s\S]*\.admin-topbar__actions,[\s\S]*\.admin-button,[\s\S]*\.admin-link\s*\{[\s\S]*width:\s*100%;/);
  assert.match(adminHtml, /name="bookingAction"/);
  assert.match(adminJs, /\/api\/admin\/bookings\/checkout/);
});

test('public bootstrap and admin login endpoints expose launch-critical flags', async () => {
  const server = await createTestServer();

  try {
    const bootstrap = await requestJson(server, '/api/public/bootstrap');
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.body.ok, true);
    assert.equal(bootstrap.body.data.featureFlags['public.section.instagram'], true);
    assert.equal(bootstrap.body.data.featureFlags.instagram, false);
    assert.equal(bootstrap.body.data.featureFlags.adminCalendar, true);
    assert.equal(bootstrap.body.data.featureFlags.adminPropertyMap, true);
    assert.equal(bootstrap.body.data.featureFlags.refunds, true);
    assert.equal(bootstrap.body.data.featureFlags.employeeMode, true);
    assert.equal(bootstrap.body.data.settings.instagramHandle, 'midwaygrocer');
    assert.equal(bootstrap.body.data.settings.instagramUrl, 'https://www.instagram.com/midwaygrocer/');
    assert.equal(bootstrap.body.data.settings.instagramPosts, undefined);
    assert.ok(bootstrap.body.data.rvSites.length >= 24);
    assert.ok(bootstrap.body.data.rvSites.some(site => site.id === 'tent-01' && site.type === 'tent'));

    const badLogin = await requestJson(server, '/api/admin/auth/login', {
      method: 'POST',
      body: { email: 'owner@midway.local', password: 'wrong-pass' },
    });
    assert.equal(badLogin.status, 401);
    assert.equal(badLogin.body.error.code, 'ADMIN_LOGIN_FAILED');

    const login = await requestJson(server, '/api/admin/auth/login', {
      method: 'POST',
      body: { email: 'owner@midway.local', password: 'owner-pass' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.user.role, 'owner');
    assert.ok(login.body.data.token);

    const me = await requestJson(server, '/api/admin/me', {
      token: login.body.data.token,
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.data.user.email, 'owner@midway.local');
    assert.equal(me.body.data.featureFlags['booking.admin_calendar'], true);
    assert.equal(me.body.data.featureFlags['booking.admin_property_map'], true);
    assert.equal(me.body.data.featureFlags['payments.refunds'], true);

    const adminSettings = await requestJson(server, '/api/admin/settings', {
      token: login.body.data.token,
    });
    assert.equal(adminSettings.status, 200);
    assert.equal(adminSettings.body.data.business.publicBrandName, 'Midway Gas & Grocery');
    assert.equal(adminSettings.body.data.providers.some(provider => provider.providerKey === 'square'), true);
    assert.equal(adminSettings.body.data.providers.some(provider => provider.providerKey === 'instagram'), true);
    assert.equal(JSON.stringify(adminSettings.body.data).includes('accessToken'), false);
  } finally {
    await server.close();
  }
});

async function createTestServer() {
  const app = express();
  app.use(express.json({
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString('utf8');
    },
  }));
  app.use('/api', createApiRouter({
    env,
    store: createMidwayHarness({ env, tenantConfig: createVisualTenantConfig() }),
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

function createVisualTenantConfig() {
  return createTenantConfig({
    tenantId: 'midway',
    locationId: 'plain',
    business: {
      name: 'Midway Gas & Grocery',
      publicBrandName: 'Midway Gas & Grocery',
      phone: '(206) 669-5880',
      address: '14193 Chiwawa Loop RD, Leavenworth, WA 98826',
      timezone: 'America/Los_Angeles',
      instagramHandle: 'midwaygrocer',
    },
    publicSite: {
      theme: 'midway_farmhouse',
      instagramPosts: [],
      sections: [
        {
          key: 'instagram',
          enabled: true,
          title: 'Fresh from Midway.',
          copy: 'Store moments shown as a native gallery.',
          items: [
            { title: 'Coffee and shelves', description: 'Inside the store.', image: '/images/store-interior.jpg' },
          ],
        },
      ],
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

async function requestJson(server, route, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${server.url}${route}`, {
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

async function readProjectFile(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function assertAssetExists(relativePath) {
  const stats = await fs.stat(path.join(repoRoot, relativePath));
  assert.equal(stats.isFile(), true, `${relativePath} should exist`);
  assert.ok(stats.size > 0, `${relativePath} should not be empty`);
}
