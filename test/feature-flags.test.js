import test from 'node:test';
import assert from 'node:assert/strict';

import { createFeatureFlagEvaluator } from '../src/lib/feature-flags.js';
import { createMidwayHarness } from '../src/lib/midway-harness.js';
import { createTenantConfig } from '../src/lib/tenant-config.js';

test('feature flags resolve canonical keys and legacy public aliases', () => {
  const evaluator = createFeatureFlagEvaluator({
    env: {
      FEATURE_FLAGS_JSON: JSON.stringify({
        'booking.rv.enabled': false,
        'public.section.instagram': true,
      }),
    },
  });

  const flags = evaluator.all();

  assert.equal(flags['booking.rv.enabled'], false);
  assert.equal(flags.rvBooking, false);
  assert.equal(flags['public.section.instagram'], true);
  assert.equal(flags.instagram, true);
});

test('employee role disables owner-only booking features', () => {
  const flags = createFeatureFlagEvaluator({ role: 'employee' }).all();

  assert.equal(flags['booking.manual_admin'], false);
  assert.equal(flags.manualAdminBooking, false);
  assert.equal(flags['payments.refunds'], false);
});

test('public bootstrap hides disabled RV booking and includes Instagram settings', async () => {
  const store = createMidwayHarness({
    env: {
      NODE_ENV: 'test',
      FEATURE_FLAGS_JSON: JSON.stringify({
        'booking.rv.enabled': false,
        'public.section.instagram': true,
      }),
    },
    tenantConfig: createTenantConfig({
      business: { instagramHandle: 'midwayplain' },
      publicSite: {
        instagramPosts: [
          'https://www.instagram.com/p/example-one/',
          'https://www.instagram.com/reel/example-two/',
        ],
      },
    }),
  });

  const bootstrap = await store.publicBootstrap();

  assert.equal(bootstrap.featureFlags.rvBooking, false);
  assert.equal(bootstrap.rvSites.length, 0);
  assert.equal(bootstrap.featureFlags.instagram, true);
  assert.equal(bootstrap.settings.instagramHandle, 'midwayplain');
  assert.equal(bootstrap.settings.instagramUrl, 'https://www.instagram.com/midwayplain/');
  assert.deepEqual(bootstrap.settings.instagramPosts, [
    'https://www.instagram.com/p/example-one/',
    'https://www.instagram.com/reel/example-two/',
  ]);
});

test('public bootstrap can populate Instagram from the Graph API feed', async () => {
  const store = createMidwayHarness({
    env: {
      INSTAGRAM_USER_ID: '17841400000000000',
      INSTAGRAM_ACCESS_TOKEN: 'secret-token',
    },
    tenantConfig: {
      business: { instagramHandle: 'midwayplain' },
      publicSite: {
        sections: [{ key: 'instagram', enabled: true }],
      },
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'ig-1',
            caption: 'Fresh from Plain.',
            media_type: 'IMAGE',
            media_url: 'https://cdn.example/post.jpg',
            permalink: 'https://www.instagram.com/p/api-post/',
          },
        ],
      }),
    }),
  });

  const bootstrap = await store.publicBootstrap();

  assert.equal(bootstrap.featureFlags.instagram, true);
  assert.deepEqual(bootstrap.settings.instagramFeed, [
    {
      id: 'ig-1',
      title: 'Fresh from Plain',
      caption: 'Fresh from Plain.',
      image: 'https://cdn.example/post.jpg',
      mediaUrl: 'https://cdn.example/post.jpg',
      thumbnailUrl: '',
      permalink: 'https://www.instagram.com/p/api-post/',
      mediaType: 'IMAGE',
      timestamp: '',
      username: '',
      source: 'instagram-api',
    },
  ]);
  assert.equal(JSON.stringify(bootstrap).includes('secret-token'), false);
});
