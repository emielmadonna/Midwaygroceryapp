import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RV_MAP_COORDINATE_SYSTEM,
  denormalizeMapSite,
  getRvMapSiteByNumber,
  rvMapSites,
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

test('every RV site has required booking and catalog fields', () => {
  for (const site of rvMapSites) {
    assert.ok(site.id, `site ${site.siteNumber} has an id`);
    assert.ok(site.displayName, `site ${site.siteNumber} has a display name`);
    assert.ok(site.sku, `site ${site.siteNumber} has a SKU`);
    assert.ok(Number.isInteger(site.maxRvLengthFeet), `site ${site.siteNumber} has max length`);
    assert.ok(site.maxRvLengthFeet > 0, `site ${site.siteNumber} has positive max length`);
    assert.ok(Array.isArray(site.amenities), `site ${site.siteNumber} has amenities`);
    assert.ok(site.amenities.length > 0, `site ${site.siteNumber} has at least one amenity`);
    assert.ok(site.customerNotes, `site ${site.siteNumber} has customer notes`);
  }
});

test('every RV site has normalized map coordinates', () => {
  assert.equal(RV_MAP_COORDINATE_SYSTEM.type, 'normalized');

  for (const site of rvMapSites) {
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
  assert.equal(legacySite.mapX, 884);
  assert.equal(legacySite.mapY, 210);
  assert.equal(legacySite.mapWidth, 88);
  assert.equal(legacySite.mapHeight, 38);
});
