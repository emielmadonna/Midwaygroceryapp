import test from 'node:test';
import assert from 'node:assert/strict';

import { loadTenantRuntimeConfig } from '../src/lib/supabase-server.js';
import { createTenantConfig, getProviderConfig } from '../src/lib/tenant-config.js';

test('empty tenant config does not invent business or provider values', () => {
  const config = createTenantConfig({ tenantId: 'demo', locationId: 'main' });

  assert.equal(config.business.name, '');
  assert.equal(config.business.phone, '');
  assert.deepEqual(config.providers, {});
});

test('tenant runtime config loads Supabase tenant, location, site, provider, and frontend rows', async () => {
  const supabase = createFakeSupabase({
    tenants: [
      {
        id: 'demo',
        name: 'Demo Tenant',
        status: 'active',
        business_profile: 'market_rv',
        default_theme: 'tenant_theme',
      },
    ],
    locations: [
      {
        tenant_id: 'demo',
        id: 'main',
        name: 'Demo Location',
        address: '10 Main St',
        phone: '(555) 010-1000',
        timezone: 'America/Los_Angeles',
        status: 'active',
      },
    ],
    site_settings: [
      {
        tenant_id: 'demo',
        location_id: 'main',
        business_name: 'Demo Market',
        public_brand_name: 'Demo Public',
        address: '11 Public St',
        phone: '(555) 010-2000',
        email: 'hello@example.com',
        timezone: 'America/Denver',
        instagram_handle: '@demo_market',
        instagram_posts: ['https://www.instagram.com/p/demo-post/'],
        public_site_url: 'https://demo.example',
        theme_key: 'site_theme',
      },
    ],
    provider_connections: [
      {
        tenant_id: 'demo',
        location_id: null,
        provider_key: 'square',
        provider_kind: 'payment',
        status: 'connected',
        public_config: {
          applicationId: 'tenant-app',
          locationId: 'tenant-location',
          environment: 'sandbox',
        },
        encrypted_credentials: { accessToken: 'tenant-token' },
        scopes: ['PAYMENTS_WRITE'],
      },
      {
        tenant_id: 'demo',
        location_id: 'main',
        provider_key: 'square',
        provider_kind: 'payment',
        status: 'connected',
        public_config: {
          applicationId: 'location-app',
          locationId: 'location-square',
          environment: 'production',
          checkoutSurface: 'web-payments',
        },
        encrypted_credentials: {
          accessToken: 'location-token',
          webhookSignatureKey: 'webhook-secret',
        },
        scopes: ['PAYMENTS_WRITE', 'ORDERS_WRITE'],
        external_location_id: 'external-location',
      },
    ],
    frontend_configs: [
      {
        tenant_id: 'demo',
        location_id: 'main',
        theme_key: 'frontend_theme',
        business_profile: 'frontend_profile',
        sections: [{ key: 'hero' }],
        draft_config: { draft: true },
        published_config: { published: true },
      },
    ],
  });

  const config = await loadTenantRuntimeConfig(supabase, {
    tenantId: 'demo',
    locationId: 'main',
  });

  assert.equal(config.business.publicBrandName, 'Demo Public');
  assert.equal(config.business.phone, '(555) 010-2000');
  assert.equal(config.business.instagramHandle, 'demo_market');
  assert.equal(config.publicSite.url, 'https://demo.example');
  assert.equal(config.publicSite.theme, 'frontend_theme');
  assert.deepEqual(config.frontend.sections, [{ key: 'hero' }]);

  const square = getProviderConfig(config, 'square');
  assert.equal(square.applicationId, 'location-app');
  assert.equal(square.locationId, 'location-square');
  assert.equal(square.environment, 'production');
  assert.equal(square.accessToken, 'location-token');
  assert.equal(square.webhookSignatureKey, 'webhook-secret');
});

function createFakeSupabase(rowsByTable) {
  return {
    from(table) {
      return new FakeQuery(rowsByTable[table] ?? []);
    },
  };
}

class FakeQuery {
  constructor(rows) {
    this.rows = rows;
    this.filters = [];
  }

  select() {
    return this;
  }

  eq(key, value) {
    this.filters.push(row => row[key] === value);
    return this;
  }

  is(key, value) {
    this.filters.push(row => row[key] === value);
    return this;
  }

  maybeSingle() {
    return Promise.resolve({
      data: this.applyFilters()[0] ?? null,
      error: null,
    });
  }

  then(resolve, reject) {
    return Promise.resolve({
      data: this.applyFilters(),
      error: null,
    }).then(resolve, reject);
  }

  applyFilters() {
    return this.rows.filter(row => this.filters.every(filter => filter(row)));
  }
}
