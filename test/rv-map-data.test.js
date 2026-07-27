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

test('RV site rates and hookup types match the published inventory plan', () => {
  const site15 = getRvMapSiteByNumber(15);
  const site16 = getRvMapSiteByNumber(16);

  // Sites 03-10 (the right row) are the FULL HOOKUP pads: water/electric/septic,
  // $45, 40 ft, rendered blue. Sites 11-14 (lower left row) are PARTIAL:
  // water + electric only, $40, 30 ft, rendered yellow. This matches the live
  // Supabase rv_sites rows, which are the source of truth for price/amenities.
  for (const siteNumber of [3, 4, 5, 6, 7, 8, 9, 10]) {
    const site = getRvMapSiteByNumber(siteNumber);
    assert.equal(site.hookup, 'full', `site ${siteNumber} is full hookup`);
    assert.equal(site.nightlyPriceCents, 4500, `site ${siteNumber} is $45`);
    assert.equal(site.maxRvLengthFeet, 40, `site ${siteNumber} allows 40 ft`);
    assert.ok(site.amenities.includes('Full hookup'), `site ${siteNumber} lists full hookup`);
    assert.ok(site.amenities.includes('Septic'), `site ${siteNumber} lists septic`);
    assert.ok(site.amenities.includes('Water'), `site ${siteNumber} lists water`);
  }

  for (const siteNumber of [11, 12, 13, 14]) {
    const site = getRvMapSiteByNumber(siteNumber);
    assert.equal(site.hookup, 'partial', `site ${siteNumber} is partial hookup`);
    assert.equal(site.nightlyPriceCents, 4000, `site ${siteNumber} is $40`);
    assert.equal(site.maxRvLengthFeet, 30, `site ${siteNumber} allows 30 ft`);
    assert.ok(site.amenities.includes('Partial hookup'), `site ${siteNumber} lists partial hookup`);
    assert.ok(site.amenities.includes('Water'), `site ${siteNumber} lists water`);
    assert.ok(site.amenities.includes('Electricity'), `site ${siteNumber} lists electricity`);
    assert.equal(site.amenities.includes('Septic'), false, `site ${siteNumber} has no septic`);
    assert.equal(site.amenities.includes('Full hookup'), false, `site ${siteNumber} is not full hookup`);
  }

  // 15 (park mobile, inactive) and 16 stay full hookup at $45.
  assert.equal(site15.status, 'inactive');
  assert.equal(site15.hookup, 'full');
  assert.equal(site16.hookup, 'full');
  assert.equal(site16.nightlyPriceCents, 4500);
  assert.equal(tentMapSites[0].nightlyPriceCents, 2000);
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
