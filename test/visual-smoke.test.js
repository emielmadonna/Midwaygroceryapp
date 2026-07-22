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
  assert.match(appJsx, /applePay\(paymentRequest\)/);
  assert.match(appJsx, /googlePay\(paymentRequest\)/);
  assert.match(appJsx, /mountedGooglePay\.attach/);
  assert.match(appJsx, /buildSquarePaymentRequest/);
  assert.match(appJsx, /buildSquareVerificationDetails/);
  assert.match(appJsx, /createPaymentIdempotencyKey/);
  assert.doesNotMatch(appJsx, /payment-\$\{session\.bookingCode\}-\$\{methodLabel/);
  assert.match(appJsx, /const BookingAgreementPanel =/);
  assert.match(appJsx, /Campground <em>agreement\.<\/em>/);
  assert.match(appJsx, /I agree to quiet hours from 10:00 PM to 8:00 AM\./);
  assert.match(appJsx, /\['agreement', 'Rules'\]/);
  assert.match(appJsx, /GOOGLE_MAPS_EMBED_KEY/);
  assert.match(appJsx, /GOOGLE_MAPS_SHARE_EMBED_SRC/);
  assert.match(appJsx, /mapEmbedHref/);
  assert.match(appJsx, /return GOOGLE_MAPS_SHARE_EMBED_SRC;/);
  assert.match(appJsx, /google\.com\/maps\/embed\?pb=/);
  assert.match(appJsx, /maptype=satellite/);
  assert.match(appJsx, /<iframe title="Map to Midway Gas & Grocery"/);
  assert.doesNotMatch(appJsx, /className="map-fallback"/);
  assert.match(appJsx, /loading="eager"/);
  assert.match(appJsx, /allowFullScreen/);
  assert.match(appJsx, /<section className="section" id="find"/);
  assert.doesNotMatch(appJsx, /<section className="section reveal" id="find"/);
  assert.match(appJsx, /addEventListener\('wheel',\s*onWheel,\s*\{\s*passive:\s*false\s*\}\)/);
  assert.doesNotMatch(appJsx, /onWheel=\{onWheel\}/);
  assert.match(appJsx, /onPointerDown=\{onPointerDown\}/);
  assert.doesNotMatch(appJsx, /className="map-zoom"/);
  assert.doesNotMatch(appJsx, /synthetic-card-token|DEFAULT_SITES|RESERVATION_KEY/);

  await assertAssetExists('src/midway.jsx');
  await assertAssetExists('public/images/exterior-detailed.jpg');
  await assertAssetExists('public/assets/midway-logo.png');

  assert.match(styles, /body\s*\{[\s\S]*overflow-x:\s*hidden;/);
  assert.match(styles, /\.instagram-gallery\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.instagram-card\s*\{[\s\S]*display:\s*block;/);
  assert.match(styles, /\.square-card-host\s*\{[\s\S]*min-height:\s*96px;/);
  assert.match(styles, /\.apple-pay-button\s*\{[\s\S]*-webkit-named-image\(apple-pay-logo-white\)/);
  assert.match(styles, /\.google-pay-host\s*\{[\s\S]*min-height:\s*48px;/);
  assert.match(styles, /\.booking-steps\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /\.agreement-panel\s*\{[\s\S]*border-radius:\s*18px;/);
  assert.match(styles, /\.agreement-scroll\s*\{[\s\S]*max-height:\s*300px;/);
  assert.match(styles, /\.map\s*\{[\s\S]*min-height:\s*360px;/);
  assert.match(styles, /\.map iframe\s*\{[\s\S]*display:\s*block;/);
  assert.doesNotMatch(styles, /\.map-fallback\s*\{/);
  assert.match(styles, /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*\.map\s*\{[\s\S]*min-height:\s*320px;/);
  assert.doesNotMatch(styles, /\.map-zoom\s*\{/);
  assert.match(styles, /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*\.nav-links\s*\{\s*display:\s*none;/);
  assert.match(styles, /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*\.instagram-gallery\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*\.nav-actions\s*\{\s*display:\s*flex;\s*gap:\s*8px;/);
  assert.match(styles, /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*\.nav-action\s*\{\s*display:\s*none;/);
  assert.match(styles, /@media\s*\(max-width:\s*920px\)\s*\{[\s\S]*\.nav-brand-sub\s*\{\s*display:\s*none;/);
  assert.match(styles, /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*\.hero-actions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*1fr;/);
  assert.match(styles, /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*\.instagram-gallery,[\s\S]*\.book-form \.row2/);
});

test('command center keeps secure login, chat uploads, operational views, and mobile navigation', async () => {
  const [adminHtml, adminJs, adminCss] = await Promise.all([
    readProjectFile('admin.html'),
    readProjectFile('src/command-center.jsx'),
    readProjectFile('src/styles/command-center.css'),
  ]);

  assert.match(adminHtml, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1\.0"/);
  assert.match(adminHtml, /<div\s+id="root"><\/div>/);
  assert.match(adminHtml, /Midway Command Center/);
  assert.match(adminHtml, /type="module"\s+src="\/src\/command-center\.jsx"/);

  assert.match(adminJs, /\/admin\/auth\/login/);
  assert.match(adminJs, /sessionStorage\.setItem\(TOKEN_KEY,\s*payload\.data\.token\)/);
  assert.match(adminJs, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(adminJs, /\/admin\/me/);
  assert.match(adminJs, /\/admin\/command-center\/overview/);
  assert.match(adminJs, /\/admin\/command-center\/inventory/);
  assert.match(adminJs, /\/admin\/command-center\/square\/sync/);
  assert.match(adminJs, /\/admin\/command-center\/connectors/);
  assert.match(adminJs, /\/admin\/command-center\/sales\?days=/);
  assert.match(adminJs, /data quality/i);
  assert.match(adminJs, /Planning forecast/);
  assert.match(adminJs, /\/admin\/agent\/turn\/stream/);
  assert.match(adminJs, /readEventStream/);
  assert.match(adminJs, /friendlyToolActivity/);
  assert.match(adminJs, /pendingConfirmation/);
  assert.match(adminJs, /accept="image\/\*,\.pdf,\.csv/);
  assert.match(adminJs, /readAsDataURL/);
  assert.match(adminJs, /user\?\.role === 'owner'/);

  assert.match(adminCss, /\.cc-app\s*\{[\s\S]*grid-template-columns:\s*248px minmax\(0,\s*1fr\)/);
  assert.match(adminCss, /\.cc-metrics\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(adminCss, /\.cc-assistant\s*\{[\s\S]*grid-template-columns:\s*225px minmax\(0,\s*1fr\)/);
  assert.match(adminCss, /\.cc-live-activity/);
  assert.match(adminCss, /\.cc-stream-cursor/);
  assert.match(adminCss, /@media\s*\(max-width:\s*900px\)[\s\S]*\.cc-mobile-nav\s*\{[\s\S]*display:\s*grid;/);
  assert.match(adminCss, /@media\s*\(max-width:\s*620px\)[\s\S]*\.cc-metrics\s*\{[\s\S]*grid-template-columns:\s*1fr 1fr;/);
  assert.match(adminCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
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
      phone: '(509) 596-1076',
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
