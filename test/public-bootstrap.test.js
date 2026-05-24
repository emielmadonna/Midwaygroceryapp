import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPublicBootstrap,
  normalizeSquareProducts,
} from '../src/lib/public-bootstrap.js';

test('empty optional data collapses public sections through feature flags', () => {
  const bootstrap = buildPublicBootstrap({
    rvSites: [{ id: 'site-1', siteNumber: '01', status: 'active' }],
    squareProducts: [],
    fuelPrices: [],
    events: [],
    coffeeMenu: [],
  });

  assert.equal(bootstrap.featureFlags.rvBooking, true);
  assert.equal(bootstrap.featureFlags.products, false);
  assert.equal(bootstrap.featureFlags.fuel, false);
  assert.equal(bootstrap.featureFlags.events, false);
  assert.equal(bootstrap.featureFlags.coffee, false);
});

test('empty public sections stay collapsed even when optional aliases are enabled', () => {
  const bootstrap = buildPublicBootstrap({
    settings: {},
    squareProducts: [],
    fuelPrices: [],
    events: [],
    coffeeMenu: [],
    featureFlags: {
      fuel: true,
      products: true,
      events: true,
      coffee: true,
      instagram: true,
    },
  });

  assert.equal(bootstrap.featureFlags.products, false);
  assert.equal(bootstrap.featureFlags.fuel, false);
  assert.equal(bootstrap.featureFlags.events, false);
  assert.equal(bootstrap.featureFlags.coffee, false);
  assert.equal(bootstrap.featureFlags.instagram, false);
});

test('Square catalog products are normalized for the landing page', () => {
  const products = normalizeSquareProducts([
    {
      id: 'ITEM_1',
      itemData: {
        name: 'Firewood Bundle',
        description: 'Local bundle',
        categories: [{ name: 'Camping' }],
        variations: [
          {
            id: 'VAR_1',
            itemVariationData: {
              priceMoney: { amount: 800n, currency: 'USD' },
              sku: 'FIREWOOD-BUNDLE',
            },
          },
        ],
      },
    },
  ]);

  assert.deepEqual(products, [
    {
      id: 'ITEM_1',
      variationId: 'VAR_1',
      sku: 'FIREWOOD-BUNDLE',
      name: 'Firewood Bundle',
      description: 'Local bundle',
      priceCents: 800,
      currency: 'USD',
      category: 'Camping',
      source: 'square',
    },
  ]);
});

test('persisted Square inventory rows normalize for public products', () => {
  const products = normalizeSquareProducts([
    {
      squareItemId: 'ITEM_1',
      squareVariationId: 'VAR_1',
      sku: 'FIREWOOD-BUNDLE',
      name: 'Firewood Bundle',
      description: 'Local bundle',
      priceCents: 800,
      currency: 'USD',
      category: 'Camping',
      active: true,
      hidden: false,
    },
  ]);

  assert.deepEqual(products, [
    {
      id: 'ITEM_1',
      variationId: 'VAR_1',
      sku: 'FIREWOOD-BUNDLE',
      name: 'Firewood Bundle',
      description: 'Local bundle',
      priceCents: 800,
      currency: 'USD',
      category: 'Camping',
      source: 'square',
    },
  ]);
});

test('booking catalog items are excluded from public store products', () => {
  const products = normalizeSquareProducts([
    {
      squareItemId: 'ITEM_RV_FULL',
      squareVariationId: 'VAR_RV_FULL',
      sku: 'MIDWAY-RV-FULL-HOOKUP-NIGHT',
      name: 'RV Full Hookup Night',
      priceCents: 4500,
      active: true,
    },
    {
      squareItemId: 'ITEM_RV_PARTIAL',
      squareVariationId: 'VAR_RV_PARTIAL',
      sku: 'MIDWAY-RV-PARTIAL-HOOKUP-NIGHT',
      name: 'RV Partial Hookup Night',
      priceCents: 4000,
      active: true,
    },
    {
      squareItemId: 'ITEM_TENT',
      squareVariationId: 'VAR_TENT',
      sku: 'MIDWAY-TENT-CAMPING-NIGHT',
      name: 'Tent Camping Night',
      priceCents: 2000,
      active: true,
    },
    {
      squareItemId: 'ITEM_VEHICLE',
      squareVariationId: 'VAR_VEHICLE',
      sku: 'MIDWAY-EXTRA-VEHICLE',
      name: 'Extra Vehicle Fee',
      priceCents: 1000,
      active: true,
    },
    {
      squareItemId: 'ITEM_FIREWOOD',
      squareVariationId: 'VAR_FIREWOOD',
      sku: 'FIREWOOD-BUNDLE',
      name: 'Firewood Bundle',
      priceCents: 800,
      active: true,
    },
  ]);

  assert.deepEqual(products.map(product => product.sku), ['FIREWOOD-BUNDLE']);
});

test('disabled public sections stay hidden while enabled empty sections collapse', () => {
  const bootstrap = buildPublicBootstrap({
    settings: {
      instagramHandle: 'midwayplain',
      sections: [
        { key: 'instagram', enabled: false },
        { key: 'events', enabled: true, items: [] },
      ],
    },
    events: [],
    featureFlags: {
      instagram: true,
      events: true,
    },
  });

  assert.equal(bootstrap.featureFlags.instagram, false);
  assert.equal(bootstrap.featureFlags.events, false);
});
