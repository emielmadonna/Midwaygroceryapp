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
