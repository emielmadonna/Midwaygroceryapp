import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RV_MAP_COORDINATE_SYSTEM,
  bookableMapSites,
  denormalizeMapSite,
  getRvMapSiteByNumber,
  rvMapSites,
  tentMapSites,
} from '../src/lib/rv-map-data.js';

test('RV map data includes exactly 14 uniquely numbered sites', () => {
  assert.equal(rvMapSites.length, 14);

  const siteNumbers = rvMapSites.map(site => site.siteNumber);
  assert.equal(new Set(siteNumbers).size, rvMapSites.length);
  assert.deepEqual(siteNumbers, [
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
  ]);
});

test('bookable map data includes 10 tent areas', () => {
  assert.equal(tentMapSites.length, 10);
  assert.equal(bookableMapSites.length, 24);
  assert.deepEqual(tentMapSites.map(site => site.siteNumber), [
    'T01',
    'T02',
    'T03',
    'T04',
    'T05',
    'T06',
    'T07',
    'T08',
    'T09',
    'T10',
  ]);
});

test('every bookable site has required booking and catalog fields', () => {
  for (const site of bookableMapSites) {
    assert.ok(site.id, `site ${site.siteNumber} has an id`);
    assert.ok(site.displayName, `site ${site.siteNumber} has a display name`);
    assert.ok(site.sku, `site ${site.siteNumber} has a SKU`);
    assert.ok(Number.isInteger(site.maxRvLengthFeet), `site ${site.siteNumber} has max length`);
    if (site.type === 'tent') {
      assert.equal(site.maxRvLengthFeet, 0, `site ${site.siteNumber} has no RV length limit`);
    } else {
      assert.ok(site.maxRvLengthFeet > 0, `site ${site.siteNumber} has positive max length`);
    }
    assert.ok(Array.isArray(site.amenities), `site ${site.siteNumber} has amenities`);
    assert.ok(site.amenities.length > 0, `site ${site.siteNumber} has at least one amenity`);
    assert.ok(site.customerNotes, `site ${site.siteNumber} has customer notes`);
  }
});

test('every bookable site has normalized map coordinates', () => {
  assert.equal(RV_MAP_COORDINATE_SYSTEM.type, 'normalized');

  for (const site of bookableMapSites) {
    assert.equal(typeof site.mapX, 'number', `site ${site.siteNumber} has mapX`);
    assert.equal(typeof site.mapY, 'number', `site ${site.siteNumber} has mapY`);
    assert.ok(site.mapX >= 0 && site.mapX <= 1, `site ${site.siteNumber} mapX is normalized`);
    assert.ok(site.mapY >= 0 && site.mapY <= 1, `site ${site.siteNumber} mapY is normalized`);
    assert.ok(site.mapWidth > 0 && site.mapWidth <= 1, `site ${site.siteNumber} width is normalized`);
    assert.ok(site.mapHeight > 0 && site.mapHeight <= 1, `site ${site.siteNumber} height is normalized`);
  }
});

test('RV map helpers support legacy SVG viewBox rendering', () => {
  const site = getRvMapSiteByNumber(3);
  assert.equal(site.siteNumber, '03');

  const legacySite = denormalizeMapSite(site);
  assert.equal(legacySite.mapX, 992);
  assert.equal(legacySite.mapY, 244);
  assert.equal(legacySite.mapWidth, 78);
  assert.equal(legacySite.mapHeight, 34);
});
