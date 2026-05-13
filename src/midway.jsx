/* global Square */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// ─── Data ───────────────────────────────────────────────────────────────────
const API_ROOT = ['3000', '3002', '5173'].includes(window.location.port)
  ? 'http://127.0.0.1:3001/api'
  : '/api';

const COFFEE = {};
const EVENTS = [];
let squareSdkPromise;
const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABELS = {
  sunday: 'Sun',
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
};
const FALLBACK_SETTINGS = {
  businessName: 'Midway Gas & Grocery',
  phone: '(509) 669-9378',
  address: '14193 Chiwawa Loop RD, Leavenworth, WA 98826',
  timezone: 'America/Los_Angeles',
  instagramHandle: 'midwayplain',
  instagramUrl: 'https://www.instagram.com/midwayplain/',
};
const FALLBACK_HOURS = [
  { day: 'monday', open: '6:00 AM', close: '9:00 PM' },
  { day: 'tuesday', open: '6:00 AM', close: '9:00 PM' },
  { day: 'wednesday', open: '6:00 AM', close: '9:00 PM' },
  { day: 'thursday', open: '6:00 AM', close: '9:00 PM' },
  { day: 'friday', open: '6:00 AM', close: '9:00 PM' },
  { day: 'saturday', open: '7:00 AM', close: '9:00 PM' },
  { day: 'sunday', open: '8:00 AM', close: '8:00 PM' },
];
const FALLBACK_RV_SITES = [
  { id: 'rv-03', siteNumber: '03', displayName: 'Site 03', status: 'active', nightlyPriceCents: 5800, maxRvLengthFeet: 40, mapX: 992, mapY: 244, mapWidth: 78, mapHeight: 34, rotation: -5, amp: '50A', type: 'back', shade: 'partial', sku: 'MIDWAY-RV-03-50AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Big rig', 'Walk to store'], customerNotes: 'Upper right-row full-hookup site close to the store approach.' },
  { id: 'rv-04', siteNumber: '04', displayName: 'Site 04', status: 'active', nightlyPriceCents: 5800, maxRvLengthFeet: 40, mapX: 992, mapY: 292, mapWidth: 78, mapHeight: 34, rotation: -5, amp: '50A', type: 'back', shade: 'partial', sku: 'MIDWAY-RV-04-50AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Big rig'], customerNotes: 'Right-row full-hookup site with partial shade near the upper drive.' },
  { id: 'rv-05', siteNumber: '05', displayName: 'Site 05', status: 'active', nightlyPriceCents: 5800, maxRvLengthFeet: 40, mapX: 992, mapY: 340, mapWidth: 78, mapHeight: 34, rotation: -5, amp: '50A', type: 'back', shade: 'sun', sku: 'MIDWAY-RV-05-50AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Easy entry'], customerNotes: 'Angled right-row full-hookup site with an easy approach from the loop.' },
  { id: 'rv-06', siteNumber: '06', displayName: 'Site 06', status: 'active', nightlyPriceCents: 4400, maxRvLengthFeet: 30, mapX: 992, mapY: 388, mapWidth: 78, mapHeight: 34, rotation: -5, amp: '30A', type: 'back', shade: 'sun', sku: 'MIDWAY-RV-06-30AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Pet-friendly'], customerNotes: 'Angled right-row full-hookup site with sunny exposure.' },
  { id: 'rv-07', siteNumber: '07', displayName: 'Site 07', status: 'active', nightlyPriceCents: 4400, maxRvLengthFeet: 30, mapX: 992, mapY: 456, mapWidth: 78, mapHeight: 34, rotation: -5, amp: '30A', type: 'back', shade: 'full', sku: 'MIDWAY-RV-07-30AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Forest edge', 'Quiet'], customerNotes: 'Quiet forest-edge back-in site with full shade.' },
  { id: 'rv-08', siteNumber: '08', displayName: 'Site 08', status: 'active', nightlyPriceCents: 4400, maxRvLengthFeet: 30, mapX: 992, mapY: 508, mapWidth: 78, mapHeight: 34, rotation: -5, amp: '30A', type: 'back', shade: 'full', sku: 'MIDWAY-RV-08-30AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Forest edge', 'Deep shade'], customerNotes: 'Full-shade right-row back-in site along the forest edge.' },
  { id: 'rv-09', siteNumber: '09', displayName: 'Site 09', status: 'active', nightlyPriceCents: 4400, maxRvLengthFeet: 30, mapX: 992, mapY: 560, mapWidth: 78, mapHeight: 34, rotation: -5, amp: '30A', type: 'back', shade: 'partial', sku: 'MIDWAY-RV-09-30AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Forest edge', 'Pet-friendly'], customerNotes: 'Right-row back-in site with partial shade near the lower loop.' },
  { id: 'rv-10', siteNumber: '10', displayName: 'Site 10', status: 'active', nightlyPriceCents: 4400, maxRvLengthFeet: 30, mapX: 992, mapY: 612, mapWidth: 78, mapHeight: 34, rotation: -5, amp: '30A', type: 'back', shade: 'partial', sku: 'MIDWAY-RV-10-30AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'End site', 'Picnic table'], customerNotes: 'Lower right-row end site with partial shade and a picnic table.' },
  { id: 'rv-11', siteNumber: '11', displayName: 'Site 11', status: 'active', nightlyPriceCents: 4400, maxRvLengthFeet: 30, mapX: 206, mapY: 628, mapWidth: 78, mapHeight: 34, rotation: 5, amp: '30A', type: 'back', shade: 'partial', sku: 'MIDWAY-RV-11-30AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Quiet side', 'Forest edge'], customerNotes: 'Lower left-row full-hookup site on the quieter side of the loop.' },
  { id: 'rv-12', siteNumber: '12', displayName: 'Site 12', status: 'active', nightlyPriceCents: 4400, maxRvLengthFeet: 30, mapX: 206, mapY: 580, mapWidth: 78, mapHeight: 34, rotation: 5, amp: '30A', type: 'back', shade: 'partial', sku: 'MIDWAY-RV-12-30AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Pet-friendly', 'Forest edge'], customerNotes: 'Left-row back-in site with partial shade near the lower loop.' },
  { id: 'rv-13', siteNumber: '13', displayName: 'Site 13', status: 'active', nightlyPriceCents: 4400, maxRvLengthFeet: 30, mapX: 206, mapY: 532, mapWidth: 78, mapHeight: 34, rotation: 5, amp: '30A', type: 'back', shade: 'partial', sku: 'MIDWAY-RV-13-30AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Family-size'], customerNotes: 'Left-row family-size full-hookup site with partial shade.' },
  { id: 'rv-14', siteNumber: '14', displayName: 'Site 14', status: 'active', nightlyPriceCents: 5800, maxRvLengthFeet: 40, mapX: 206, mapY: 484, mapWidth: 78, mapHeight: 34, rotation: 5, amp: '50A', type: 'back', shade: 'partial', sku: 'MIDWAY-RV-14-50AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Premium', 'Big rig'], customerNotes: 'Premium 50 amp full-hookup site on the left row.' },
  { id: 'rv-15', siteNumber: '15', displayName: 'Site 15', status: 'active', nightlyPriceCents: 5800, maxRvLengthFeet: 40, mapX: 206, mapY: 436, mapWidth: 78, mapHeight: 34, rotation: 5, amp: '50A', type: 'back', shade: 'partial', sku: 'MIDWAY-RV-15-50AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Premium', 'Road edge'], customerNotes: 'Premium 50 amp left-row site with partial shade.' },
  { id: 'rv-16', siteNumber: '16', displayName: 'Site 16', status: 'active', nightlyPriceCents: 5800, maxRvLengthFeet: 40, mapX: 206, mapY: 388, mapWidth: 78, mapHeight: 34, rotation: 5, amp: '50A', type: 'back', shade: 'partial', sku: 'MIDWAY-RV-16-50AMP', amenities: ['Full hookup', 'Water', 'Sewer', 'Premium', 'End site', 'Walk to store'], customerNotes: 'Upper left-row premium end site closest to the store side.' },
  { id: 'tent-01', siteNumber: 'T01', displayName: 'Tent 01', status: 'active', nightlyPriceCents: 2800, maxRvLengthFeet: 0, mapX: 506, mapY: 430, mapWidth: 48, mapHeight: 30, rotation: -2, amp: 'Tent', type: 'tent', shade: 'partial', sku: 'MIDWAY-TENT-01', amenities: ['Tent area', 'Walk-in', 'Picnic table', 'Walk to store'], customerNotes: 'Walk-in tent area on the center island with easy access to the store.' },
  { id: 'tent-02', siteNumber: 'T02', displayName: 'Tent 02', status: 'active', nightlyPriceCents: 2800, maxRvLengthFeet: 0, mapX: 566, mapY: 420, mapWidth: 48, mapHeight: 30, rotation: 2, amp: 'Tent', type: 'tent', shade: 'partial', sku: 'MIDWAY-TENT-02', amenities: ['Tent area', 'Walk-in', 'Picnic table', 'Walk to store'], customerNotes: 'Walk-in tent area on the center island with easy access to the store.' },
  { id: 'tent-03', siteNumber: 'T03', displayName: 'Tent 03', status: 'active', nightlyPriceCents: 2800, maxRvLengthFeet: 0, mapX: 626, mapY: 420, mapWidth: 48, mapHeight: 30, rotation: -2, amp: 'Tent', type: 'tent', shade: 'partial', sku: 'MIDWAY-TENT-03', amenities: ['Tent area', 'Walk-in', 'Picnic table', 'Walk to store'], customerNotes: 'Walk-in tent area on the center island with easy access to the store.' },
  { id: 'tent-04', siteNumber: 'T04', displayName: 'Tent 04', status: 'active', nightlyPriceCents: 2800, maxRvLengthFeet: 0, mapX: 686, mapY: 432, mapWidth: 48, mapHeight: 30, rotation: 2, amp: 'Tent', type: 'tent', shade: 'partial', sku: 'MIDWAY-TENT-04', amenities: ['Tent area', 'Walk-in', 'Picnic table', 'Walk to store'], customerNotes: 'Walk-in tent area on the center island with easy access to the store.' },
  { id: 'tent-05', siteNumber: 'T05', displayName: 'Tent 05', status: 'active', nightlyPriceCents: 2800, maxRvLengthFeet: 0, mapX: 486, mapY: 484, mapWidth: 48, mapHeight: 30, rotation: 2, amp: 'Tent', type: 'tent', shade: 'partial', sku: 'MIDWAY-TENT-05', amenities: ['Tent area', 'Walk-in', 'Picnic table', 'Walk to store'], customerNotes: 'Walk-in tent area on the center island with easy access to the store.' },
  { id: 'tent-06', siteNumber: 'T06', displayName: 'Tent 06', status: 'active', nightlyPriceCents: 2800, maxRvLengthFeet: 0, mapX: 546, mapY: 498, mapWidth: 48, mapHeight: 30, rotation: -2, amp: 'Tent', type: 'tent', shade: 'partial', sku: 'MIDWAY-TENT-06', amenities: ['Tent area', 'Walk-in', 'Picnic table', 'Walk to store'], customerNotes: 'Walk-in tent area on the center island with easy access to the store.' },
  { id: 'tent-07', siteNumber: 'T07', displayName: 'Tent 07', status: 'active', nightlyPriceCents: 2800, maxRvLengthFeet: 0, mapX: 606, mapY: 504, mapWidth: 48, mapHeight: 30, rotation: 2, amp: 'Tent', type: 'tent', shade: 'partial', sku: 'MIDWAY-TENT-07', amenities: ['Tent area', 'Walk-in', 'Picnic table', 'Walk to store'], customerNotes: 'Walk-in tent area on the center island with easy access to the store.' },
  { id: 'tent-08', siteNumber: 'T08', displayName: 'Tent 08', status: 'active', nightlyPriceCents: 2800, maxRvLengthFeet: 0, mapX: 666, mapY: 498, mapWidth: 48, mapHeight: 30, rotation: -2, amp: 'Tent', type: 'tent', shade: 'partial', sku: 'MIDWAY-TENT-08', amenities: ['Tent area', 'Walk-in', 'Picnic table', 'Walk to store'], customerNotes: 'Walk-in tent area on the center island with easy access to the store.' },
  { id: 'tent-09', siteNumber: 'T09', displayName: 'Tent 09', status: 'active', nightlyPriceCents: 2800, maxRvLengthFeet: 0, mapX: 526, mapY: 556, mapWidth: 48, mapHeight: 30, rotation: -2, amp: 'Tent', type: 'tent', shade: 'partial', sku: 'MIDWAY-TENT-09', amenities: ['Tent area', 'Walk-in', 'Picnic table', 'Walk to store'], customerNotes: 'Walk-in tent area on the center island with easy access to the store.' },
  { id: 'tent-10', siteNumber: 'T10', displayName: 'Tent 10', status: 'active', nightlyPriceCents: 2800, maxRvLengthFeet: 0, mapX: 626, mapY: 562, mapWidth: 48, mapHeight: 30, rotation: 2, amp: 'Tent', type: 'tent', shade: 'partial', sku: 'MIDWAY-TENT-10', amenities: ['Tent area', 'Walk-in', 'Picnic table', 'Walk to store'], customerNotes: 'Walk-in tent area on the center island with easy access to the store.' },
];

const toMapSite = (site, availableIds = null) => ({
  id: site.id,
  siteNumber: site.siteNumber,
  x: site.mapX,
  y: site.mapY,
  w: site.mapWidth,
  h: site.mapHeight,
  rot: site.rotation || 0,
  amp: site.amp,
  type: site.type,
  shade: site.shade,
  feats: site.amenities || [],
  nightlyPriceCents: site.nightlyPriceCents,
  maxRvLengthFeet: site.maxRvLengthFeet,
  sku: site.sku,
  taken: availableIds ? !availableIds.has(site.id) : site.status !== 'active',
});

const emptyBootstrap = {
  settings: FALLBACK_SETTINGS,
  fuelPrices: [],
  products: [],
  events: EVENTS,
  hours: FALLBACK_HOURS,
  coffeeMenu: COFFEE,
  rvSites: FALLBACK_RV_SITES,
  rvAvailability: [],
  featureFlags: {
    fuel: false,
    products: false,
    rvBooking: true,
    events: false,
    coffee: false,
    hours: true,
    instagram: true,
  },
  source: 'static-fallback',
};

const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(0)}`;
const moneyExact = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const telHref = (phone = '') => `tel:${String(phone).replace(/[^\d+]/g, '')}`;
const directionsHref = (address = '') => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
const dateInput = (offsetDays) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const normalizeHour = (hour = {}) => {
  const day = String(hour.day || hour.dayOfWeek || '').toLowerCase();
  const open = hour.open || hour.openTime || hour.open_time || '';
  const close = hour.close || hour.closeTime || hour.close_time || '';
  return day && open && close ? { day, open, close } : null;
};

const normalizedHours = (hours = []) => hours
  .map(normalizeHour)
  .filter(Boolean)
  .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));

const todayHour = (hours = []) => {
  const today = DAY_ORDER[new Date().getDay()];
  return normalizedHours(hours).find(hour => hour.day === today) || null;
};

const hourLabel = (hour) => hour ? `${hour.open} - ${hour.close}` : '';
const dateLabel = () => new Date().toLocaleDateString(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const glyphUrl = (label) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 140"><rect width="220" height="140" fill="none"/><text x="110" y="78" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#11100E">${label}</text></svg>`)}")`;
const GLYPHS = Object.freeze({
  bottle: glyphUrl('BOTTLE'),
  bread: glyphUrl('BREAD'),
  coffee: glyphUrl('COFFEE'),
  fire: glyphUrl('FIRE'),
  jar: glyphUrl('JAR'),
  pump: glyphUrl('PUMP'),
});

async function api(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message || 'Request failed.');
  }
  return payload.data;
}

const loadSquareSdk = (environment = 'sandbox') => {
  const src = environment === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js';
  if (window.Square) return Promise.resolve(window.Square);
  if (!squareSdkPromise) {
    squareSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => window.Square ? resolve(window.Square) : reject(new Error('Square payment form is unavailable.'));
      script.onerror = () => reject(new Error('Square payment form failed to load.'));
      document.head.appendChild(script);
    });
  }
  return squareSdkPromise;
};

// ─── Placeholder image with glyph + label ──────────────────────────────────
const Ph = ({ g, label, dark }) => (
  <div className={`ph${dark ? ' dark' : ''}`} style={{ '--gly': GLYPHS[g] || GLYPHS.jar }}>
    <span className="lbl">{label}</span>
  </div>
);

const Photo = ({ src, alt, label }) => (
  <>
    <img src={src} alt={alt} loading="lazy" />
    <span className="photo-label">{label}</span>
  </>
);

// ─── Scroll reveal hook ────────────────────────────────────────────────────
const useReveal = () => {
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
};

// ─── Nav ──────────────────────────────────────────────────────────────────
const Nav = ({ visible = {}, phone = '', address = '' }) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', f, { passive: true }); f();
    return () => window.removeEventListener('scroll', f);
  }, []);
  return (
    <nav className={`nav${scrolled ? ' scrolled' : ''}`}>
      <a href="#top" aria-label="Midway home" className="nav-brand">
        <img src="/assets/midway-logo.png" alt="Midway Gas & Grocery" className="nav-logo" />
        <span className="nav-brand-sub">Plain, Washington</span>
      </a>
      <div className="nav-links">
        <a href="#today">Today</a>
        {visible.coffee && <a href="#coffee">Coffee</a>}
        {visible.products && <a href="#pantry">Pantry</a>}
        {visible.rvBooking && <a href="#stay">RV Sites</a>}
        {visible.events && <a href="#events">Events</a>}
        {visible.instagram && <a href="#instagram">Instagram</a>}
        <a href="#find">Find Us</a>
      </div>
      <div className="nav-actions">
        {phone && <a href={telHref(phone)} className="nav-action">Call</a>}
        {address && <a href={directionsHref(address)} target="_blank" rel="noreferrer" className="nav-action">Directions</a>}
        {visible.rvBooking && <a href="#stay" className="nav-cta"><span className="dot" /> Book Site <span className="arr">→</span></a>}
      </div>
    </nav>
  );
};

// ─── Hero ─────────────────────────────────────────────────────────────────
const Hero = ({ flags = {}, phone = '', address = '', hours = [] }) => {
  const today = todayHour(hours);
  return (
    <header id="top" className="hero hero-redesign">
      <img className="hero-bg" src="/images/exterior-detailed.jpg" alt="Midway Gas & Grocery storefront in Plain, Washington" />
      <div className="hero-shade" aria-hidden="true" />
      <div className="hero-copy">
        {today && <div className="hero-route"><i /> Open today {hourLabel(today)}</div>}
        <h1>Midway Gas &amp; Grocery</h1>
        <p>Gas, groceries, espresso, bait, tackle, firewood, and bookable RV and tent sites at 14193 Chiwawa Loop Road.</p>
        <div className="hero-facts" aria-label="Midway quick facts">
          <span>Plain, Washington</span>
          <span>RV 03-16</span>
          <span>Tent T01-T10</span>
        </div>
        <div className="hero-actions">
          {flags.rvBooking && <a href="#stay" className="hero-link hero-primary">Book Site <span>→</span></a>}
          {address && <a href={directionsHref(address)} target="_blank" rel="noreferrer" className="hero-link hero-secondary">Directions <span>↗</span></a>}
          {phone && <a href={telHref(phone)} className="hero-link hero-secondary">Call <span>{phone}</span></a>}
        </div>
      </div>
    </header>
  );
};

// ─── Live ticker ──────────────────────────────────────────────────────────
const Ticker = ({ onJumpStay, sites, bootstrap }) => {
  const openCount = sites.filter(s => !s.taken).length;
  const fuel = bootstrap.fuelPrices || [];
  const phone = bootstrap.settings?.phone || '';
  const today = todayHour(bootstrap.hours || []);
  return (
    <section id="today" className="ticker today-strip">
      {today && <div><div className="l"><i /> OPEN TODAY</div><div className="v">{hourLabel(today)}</div><div className="s">{dateLabel()}</div></div>}
      {bootstrap.featureFlags?.fuel && fuel.map(price => (
        <div key={price.type}><div className="l"><i className="amber" /> {price.label}</div><div className="v">{price.price.toFixed(2)}<small>/GAL</small></div><div className="s">Live store update</div></div>
      ))}
      {bootstrap.featureFlags?.rvBooking && <div className="open" onClick={onJumpStay}><div className="l"><i /> CAMP SITES</div><div className="v">{openCount}<small>/{sites.length} OPEN</small></div><div className="s">Tap to book →</div></div>}
      {phone && <div><div className="l"><i /> CALL AHEAD</div><div className="v" style={{ fontSize: 25, lineHeight: 1.05, paddingTop: 6 }}>{phone}</div><div className="s">Confirm sites, hours, and arrival</div></div>}
    </section>
  );
};

// ─── Marquee ──────────────────────────────────────────────────────────────
const Marquee = () => (
  <div className="marquee reveal">
    <div className="marquee-track">
      {[...Array(2)].map((_, k) => (
        <React.Fragment key={k}>
          <span>non-ethanol fuel</span><span>diesel</span><span>espresso</span><span>ice cream</span>
          <span>groceries</span><span>beer &amp; wine</span><span>bait &amp; tackle</span><span>rv sites</span>
          <span>ice</span><span>firewood</span><span>propane</span><span>plain, washington</span>
        </React.Fragment>
      ))}
    </div>
  </div>
);

// ─── Coffee menu ─────────────────────────────────────────────────────────
const Coffee = ({ menu = COFFEE }) => {
  if (!menu || Object.keys(menu).length === 0) return null;
  return (
  <section className="section reveal" id="coffee" style={{ background: 'var(--paper)' }}>
    <div className="head">
      <h2>The bar &amp; <em>the kitchen.</em></h2>
      <p>Coffee, snacks, cold drinks, ice cream, and quick road food for people heading into Plain, Leavenworth, or a weekend stay.</p>
    </div>
    <div className="coffee-grid">
      {Object.entries(menu).map(([cat, items]) => (
        <div className="coffee-cat" key={cat}>
          <h3>{cat}</h3>
          {items.map(it => (
            <div className="item" key={it.n}>
              <div className="n">{it.n}</div>
              <div className="p">${it.p}</div>
              <div className="d">{it.d}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  </section>
  );
};

// ─── Pantry ──────────────────────────────────────────────────────────────
const Pantry = ({ products = [] }) => {
  if (!products.length) return null;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const pantry = useMemo(() => products.map((p, i) => ({
    idx: String(i + 1).padStart(2, '0'),
    name: p.name,
    desc: p.sku ? `${p.description || 'Square catalog item'} · SKU ${p.sku}` : (p.description || 'Square catalog item'),
    tag: p.category || 'Store',
    price: moneyExact(p.priceCents).replace('$', ''),
    g: iconForProduct(p),
  })), [products]);
  const cats = useMemo(() => ['All', ...Array.from(new Set(pantry.map(p => p.tag)))], [pantry]);
  const filtered = useMemo(() => pantry.filter(p => {
    const matchQ = !q || (p.name + ' ' + p.desc + ' ' + p.tag).toLowerCase().includes(q.toLowerCase());
    const matchC = cat === 'All' || p.tag === cat;
    return matchQ && matchC;
  }), [q, cat, pantry]);
  return (
    <section className="section reveal" id="pantry">
      <div className="head">
      <h2>Pantry &amp; <em>provisions.</em></h2>
        <p>The practical shelf: fuel, coffee, cold drinks, ice cream, groceries, camping supplies, beer, wine, and the stay options people ask about most.</p>
      </div>
      <div className="pantry-tools">
        <div className="pantry-search">
          <span className="ic">⌕</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the pantry — ice, bait, coffee…" />
          {q && <button onClick={() => setQ('')} style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--mute)' }}>clear ✕</button>}
        </div>
        <div className="pantry-chips">
          {cats.map(c => (
            <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div className="pantry-count">{filtered.length} of {pantry.length} Square products</div>
      <div className="pantry-scroll">
        <div className="pantry-list" style={{ borderTop: 0 }}>
          {filtered.length === 0 ? (
            <div className="pantry-empty">Nothing matches — try the chips above.</div>
          ) : filtered.map(it => (
            <div className="pantry-row" key={it.idx}>
              <div className="idx">{it.idx}</div>
              <div className="img"><Ph g={it.g} label={it.tag.toUpperCase()} /></div>
              <div>
                <div className="name">{it.name}</div>
                <div className="desc">{it.desc}</div>
              </div>
              <div className="tag">{it.tag}</div>
              <div className="price">${it.price}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

function iconForProduct(product) {
  const text = `${product.name} ${product.category || ''}`.toLowerCase();
  if (text.includes('coffee') || text.includes('espresso')) return 'coffee';
  if (text.includes('bread') || text.includes('bakery')) return 'bread';
  if (text.includes('fire') || text.includes('wood')) return 'fire';
  if (text.includes('fuel') || text.includes('diesel')) return 'pump';
  if (text.includes('wine') || text.includes('beer')) return 'bottle';
  return 'jar';
}

// ─── Site plan SVG ───────────────────────────────────────────────────────
const MAP_WORLD = { minX: -360, minY: -260, maxX: 1560, maxY: 1060 };

const SitePlan = ({ sel, setSel, sites }) => {
  const [touring, setTouring] = useState(false);
  const stageRef = useRef(null);

  // Zoom-to-site: compute transform that centers the selected pad in the viewport.
  const zoom = useMemo(() => {
    const s = sites.find(x => x.id === sel);
    if (!s) return { tx: 0, ty: 0, sc: 1 };
    const sc = 1.28;
    const cx = 600, cy = 400; // viewBox center
    const tx = clamp(cx - s.x * sc, 1200 - MAP_WORLD.maxX * sc, -MAP_WORLD.minX * sc);
    const ty = clamp(cy - s.y * sc, 800 - MAP_WORLD.maxY * sc, -MAP_WORLD.minY * sc);
    return { tx, ty, sc };
  }, [sel]);
  const mapTransform = `matrix(${zoom.sc} 0 0 ${zoom.sc} ${zoom.tx} ${zoom.ty})`;

  // Auto-tour through open sites
  useEffect(() => {
    if (!touring) return;
    const open = sites.filter(s => !s.taken).map(s => s.id);
    let i = open.indexOf(sel);
    if (i < 0) i = 0;
    setSel(open[i]);
    const t = setInterval(() => {
      i = (i + 1) % open.length;
      setSel(open[i]);
    }, 2200);
    return () => clearInterval(t);
  }, [touring]);
  const tree = (x, y, s = 1) => (
    <path key={`t${x}${y}`} d={`M${x} ${y-12*s} L${x-9*s} ${y+10*s} L${x-4*s} ${y+10*s} L${x-12*s} ${y+22*s} L${x-4*s} ${y+22*s} L${x-9*s} ${y+30*s} L${x+9*s} ${y+30*s} L${x+4*s} ${y+22*s} L${x+12*s} ${y+22*s} L${x+4*s} ${y+10*s} L${x+9*s} ${y+10*s} Z`}
       fill="#4A4936" opacity="0.42" />
  );
  const selSite = sites.find(s => s.id === sel);

  return (
    <div className={`siteplan${sel ? ' zoomed' : ''}`}>
      <div className="toolbar">
        <button onClick={() => { setSel(null); setTouring(false); }}>
          <span className="dot" /> Overview
        </button>
        <button className={touring ? 'on' : ''} onClick={() => setTouring(t => !t)}>
          {touring ? '■ Stop tour' : '▶ Tour open sites'}
        </button>
      </div>
      <svg ref={stageRef} className="stage" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="forest" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M30 8 L22 28 L26 28 L18 42 L26 42 L22 52 L38 52 L34 42 L42 42 L34 28 L38 28 Z" fill="#4A4936" opacity=".22"/>
          </pattern>
          <pattern id="water" x="0" y="0" width="40" height="14" patternUnits="userSpaceOnUse">
            <path d="M0 7 Q10 0 20 7 T40 7" stroke="#8AA39A" strokeWidth="1.2" fill="none" opacity=".7"/>
          </pattern>
        </defs>

        <g className="map-world" transform={mapTransform}>
        <rect x="-360" y="-260" width="1920" height="1320" fill="#D9D2B4"/>
        <rect x="-360" y="-260" width="1920" height="1320" fill="url(#forest)" opacity="0.35"/>

        {/* Store drive and RV loop */}
        <path d="M-80 150 L560 -42" stroke="#2A2925" strokeWidth="56" fill="none" strokeLinecap="round" opacity="0.9"/>
        <path d="M-80 150 L560 -42" stroke="#EDE7D7" strokeWidth="2" strokeDasharray="18 18" fill="none" opacity="0.8"/>
        <text x="84" y="106" fontFamily="JetBrains Mono" fontSize="11" letterSpacing="2" fill="#11100E" transform="rotate(-17 84 106)">CHIWAWA LOOP RD</text>

        <path d="M286 158 C318 232 346 266 372 300" stroke="#11100E" strokeWidth="32" fill="none" strokeLinecap="round" opacity="0.82"/>
        <path d="M286 158 C318 232 346 266 372 300" stroke="#EDE7D7" strokeWidth="2" strokeDasharray="7 11" fill="none"/>

        <path d="M372 300 C496 232 700 238 820 320 C922 392 908 566 780 650 C656 732 454 698 356 578 C272 476 288 374 372 300 Z"
              stroke="#11100E" strokeWidth="42" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.84"/>
        <path className="roadline" d="M372 300 C496 232 700 238 820 320 C922 392 908 566 780 650 C656 732 454 698 356 578 C272 476 288 374 372 300 Z"
              stroke="#EDE7D7" strokeWidth="2" strokeDasharray="7 11" fill="none"/>
        <path d="M430 364 C526 312 668 314 748 366 C812 408 802 522 724 582 C632 654 480 626 414 536 C358 458 368 400 430 364 Z"
              fill="#C5C3A2" opacity="0.78"/>
        <path d="M456 392 C540 354 654 356 720 398 C764 430 760 500 706 548 C634 612 512 590 456 522 C414 468 414 420 456 392 Z"
              fill="none" stroke="#7A776E" strokeWidth="1.3" strokeDasharray="5 8" opacity="0.5"/>
        {touring && selSite && (
          <g className="rover" transform={`translate(${selSite.x} ${selSite.y})`}>
            <circle r="14" fill="#B0341E" opacity="0.25"/>
            <circle r="7" fill="#B0341E"/>
            <circle r="3" fill="#F5F0E1"/>
          </g>
        )}

        {/* Store and yard landmarks */}
        <g>
          <rect x="420" y="118" width="130" height="84" fill="#EDE7D7" stroke="#11100E" strokeWidth="2" rx="2"/>
          <path d="M420 118 L485 88 L550 118 Z" fill="#B0341E" stroke="#11100E" strokeWidth="2"/>
          <text x="485" y="168" fontFamily="Fraunces" fontSize="14" textAnchor="middle" fill="#11100E" fontStyle="italic">store</text>
          <text x="485" y="218" fontFamily="JetBrains Mono" fontSize="8.5" letterSpacing="1.6" textAnchor="middle" fill="#11100E">MIDWAY</text>
        </g>
        <g>
          <rect x="604" y="124" width="128" height="58" fill="#D7B895" stroke="#11100E" strokeWidth="2" rx="2"/>
          <text x="668" y="202" fontFamily="JetBrains Mono" fontSize="8.5" letterSpacing="1.6" textAnchor="middle" fill="#11100E">SHOP / YARD</text>
        </g>

        {/* Common markers */}
        <g>
          <rect x="456" y="392" width="284" height="220" fill="none" stroke="#11100E" strokeWidth="1.4" strokeDasharray="4 6" rx="8"/>
          <text x="598" y="624" fontFamily="JetBrains Mono" fontSize="8" letterSpacing="1.5" textAnchor="middle" fill="#11100E">TENT AREAS T01-T10</text>
        </g>

        {/* Trees */}
        {[[48,250],[52,470],[74,610],[132,660],[318,704],[420,744],[560,748],[736,744],[932,664],[978,548],[988,430],[982,300],[930,190],[820,148],[1100,210],[1128,330],[1138,470],[1122,628]].map(([x,y]) => tree(x, y, 1))}
        {[[430,420],[520,392],[642,386],[734,424],[710,560],[600,594],[486,560],[318,464],[304,560]].map(([x,y]) => tree(x, y, 0.7))}

        {/* Pads */}
        {sites.map(s => {
          const isSel = sel === s.id;
          const label = s.siteNumber || String(s.id).replace(/\D/g, '') || s.id;
          const padW = s.w || 88;
          const padH = s.h || 38;
          return (
            <g key={s.id}
               className={`pad${s.taken ? ' taken' : ''}${isSel ? ' sel pulse' : ''}`}
               transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`}
               onClick={() => !s.taken && setSel(s.id)}>
              <rect x={-padW/2} y={-padH/2} width={padW} height={padH} rx="4"
                    fill={s.amp === '50A' ? '#F5F0E1' : '#EDE7D7'}
                    stroke="#11100E" strokeWidth={isSel ? 2.5 : 1.4}/>
              {s.taken && (
                <rect x={-padW/2} y={-padH/2} width={padW} height={padH} rx="4" fill="rgba(17,16,14,0.18)"/>
              )}
              <text x="0" y="2" fontFamily="Fraunces" fontSize="16" textAnchor="middle" fill="#11100E" dominantBaseline="middle">
                {String(label).padStart(2,'0')}
              </text>
              <text x="0" y="14" fontFamily="JetBrains Mono" fontSize="7" letterSpacing="1" textAnchor="middle" fill="#7A776E" dominantBaseline="middle">
                {s.amp}
              </text>
            </g>
          );
        })}

        <text x="1130" y="780" fontFamily="JetBrains Mono" fontSize="9" letterSpacing="2" textAnchor="end" fill="#11100E">RV 03-16 / TENT T01-T10</text>
        </g>
      </svg>

      <div className="legend">
        <div className="l"><i className="open" /> Open</div>
        <div className="l"><i className="t" /> Taken</div>
        <div className="l"><i className="s" /> Your pick</div>
      </div>
      <div className="compass"><span className="n">N</span></div>
      <div className="scale">100 FT</div>
    </div>
  );
};

// ─── Hookup booking ──────────────────────────────────────────────────────
const SquarePaymentForm = ({ session, onPay, onSuccess, onCancel }) => {
  const cardContainerId = useMemo(() => `square-card-${session.bookingCode}`, [session.bookingCode]);
  const [card, setCard] = useState(null);
  const [payments, setPayments] = useState(null);
  const [status, setStatus] = useState('Preparing secure payment form...');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checkout = session.checkout || {};
  const amount = money(checkout.amountCents || session.hold?.quote?.totalCents || 0);

  useEffect(() => {
    let disposed = false;
    let mountedCard = null;

    const setup = async () => {
      try {
        if (checkout.mode !== 'web-payments') throw new Error('Square Web Payments session is required.');

        const square = await loadSquareSdk(checkout.environment);
        if (!square?.payments) throw new Error('Square payment form is unavailable.');
        const paymentClient = square.payments(checkout.applicationId, checkout.locationId);
        mountedCard = await paymentClient.card();
        await mountedCard.attach(`#${cardContainerId}`);
        if (disposed) {
          mountedCard.destroy?.();
          return;
        }
        setPayments(paymentClient);
        setCard(mountedCard);
        setStatus('Secure card form ready.');
      } catch (err) {
        setError(err.message || 'Square payment form is unavailable.');
        setStatus('');
      }
    };

    setup();
    return () => {
      disposed = true;
      mountedCard?.destroy?.();
    };
  }, [checkout.mode, checkout.environment, checkout.applicationId, checkout.locationId, cardContainerId]);

  const submitPayment = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      let sourceId = null;
      let verificationToken = null;
      if (!card) throw new Error('The card form is still loading.');
      const result = await card.tokenize();
      if (result.status !== 'OK') {
        const message = result.errors?.map(item => item.message).filter(Boolean).join(' ') || 'Card details could not be verified.';
        throw new Error(message);
      }
      sourceId = result.token;

      if (payments?.verifyBuyer) {
        const verification = await payments.verifyBuyer(sourceId, {
          amount: ((checkout.amountCents || 0) / 100).toFixed(2),
          billingContact: {
            email: session.guest?.email || undefined,
            phone: session.guest?.phone || undefined,
            givenName: firstName(session.guest?.name),
            familyName: lastName(session.guest?.name),
          },
          currencyCode: checkout.currency || 'USD',
          intent: 'CHARGE',
        });
        verificationToken = verification?.token || null;
      }

      const paid = await onPay({
        bookingCode: session.bookingCode,
        sourceId,
        verificationToken,
        idempotencyKey: `payment-${session.bookingCode}`,
      });
      onSuccess(paid);
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again or call Midway.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal payment-modal" onClick={e => e.stopPropagation()}>
        <button className="x" onClick={onCancel}>Close</button>
        <h3>Pay <em>securely.</em></h3>
        <p>Site No. {String(session.site?.siteNumber || session.site?.id || '').padStart(2,'0')} is held for {session.nights} nights. Payment confirms the booking.</p>
        <div className="payment-summary">
          <span>{session.bookingCode}</span>
          <strong>{amount}</strong>
        </div>
        <div id={cardContainerId} className="square-card-host" />
        {status && <div className="reserve-note">{status}</div>}
        {error && <div className="reserve-note" style={{ color: 'var(--oxide)' }}>{error}</div>}
        <button className="cta payment-submit" onClick={submitPayment} disabled={busy || !card}>
          {busy ? 'Processing payment...' : `Pay ${amount}`}
        </button>
      </div>
    </div>
  );
};

const firstName = (name = '') => String(name).trim().split(/\s+/)[0] || undefined;
const lastName = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(' ') : undefined;
};

const Stay = ({ sites, fuelPrices = [], phone = '', onCheckout, onPay, onDateRangeChange }) => {
  const [sel, setSel] = useState(null);
  const [arr, setArr] = useState(dateInput(1));
  const [dep, setDep] = useState(dateInput(4));
  const [rig, setRig] = useState('Class A');
  const [heads, setHeads] = useState(2);
  const [guest, setGuest] = useState({ name: '', phone: '', email: '' });
  const [step, setStep] = useState('site');
  const [confirmed, setConfirmed] = useState(null);
  const [paymentSession, setPaymentSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nights = useMemo(() => {
    const a = new Date(arr), d = new Date(dep);
    return Math.max(1, Math.round((d - a) / 86400000));
  }, [arr, dep]);

  const selSite = useMemo(() => sites.find(s => s.id === sel), [sites, sel]);
  const rateCents = selSite?.nightlyPriceCents || 0;
  const totalCents = rateCents * nights;
  const datesReady = Boolean(arr && dep && new Date(dep) > new Date(arr));
  const siteReady = Boolean(selSite && datesReady);
  const guestReady = Boolean(guest.name.trim() && guest.phone.trim());
  const ready = siteReady && guestReady;
  const siteKindLabel = selSite?.type === 'tent'
    ? 'walk-in tent area'
    : selSite?.type === 'pull'
      ? 'pull-through'
      : 'back-in';
  const siteCapacityLabel = selSite?.type === 'tent'
    ? 'tent area'
    : `up to ${selSite?.maxRvLengthFeet || '--'} ft`;

  useEffect(() => {
    onDateRangeChange?.(arr, dep);
  }, [arr, dep]);

  useEffect(() => {
    if (!selSite) return;
    setRig(current => {
      if (selSite.type === 'tent') return current === 'Tent' ? current : 'Tent';
      return current === 'Tent' ? 'Class A' : current;
    });
  }, [selSite?.id, selSite?.type]);

  const updateGuest = (field, value) => {
    setGuest(g => ({ ...g, [field]: value }));
  };

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const checkout = await onCheckout({
        siteId: sel,
        startDate: arr,
        endDate: dep,
        guests: heads,
        vehicles: 1,
        rig,
        customer: guest,
      });
      if (checkout.checkout?.checkoutUrl) {
        window.location.href = checkout.checkout.checkoutUrl;
        return;
      }
      setPaymentSession({ ...checkout, site: selSite, guest, arr, dep, nights, rig, heads });
    } catch (err) {
      setError(err.message || 'Checkout is unavailable right now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section reveal booking-section" id="stay" style={{ background: 'var(--paper)' }}>
      <div className="head">
        <h2>Book RV or tent. <em>Right behind Midway.</em></h2>
        <p>RV sites 03-16 include water, sewer, and 30A or 50A service. Tent areas T01-T10 sit on the center island, close to coffee, fuel, ice, firewood, and groceries.</p>
      </div>

      <div className="book-wrap">
        <SitePlan sel={sel} setSel={setSel} sites={sites} />

        <div className="book-form">
          <div className="booking-steps" aria-label="Reservation steps">
            {[
              ['site', 'Site'],
              ['guest', 'Guest'],
              ['review', 'Pay'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                data-active={step === key ? 'true' : 'false'}
                disabled={(key === 'guest' && !siteReady) || (key === 'review' && !ready)}
                onClick={() => setStep(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {step === 'site' && (
            <>
              {selSite ? (
                <div className="site-detail">
                  <div className="row1">
                    <div className="num">Site <em>No. {String(selSite.siteNumber || selSite.id).padStart(2,'0')}</em></div>
                    <div className="amp">{selSite.amp} · {siteKindLabel} · {selSite.shade} shade · {siteCapacityLabel}</div>
                  </div>
                  <div className="feats">
                    {selSite.feats.map(f => <span key={f}>{f}</span>)}
                    {selSite.sku && <span>{selSite.sku}</span>}
                  </div>
                </div>
              ) : (
                <>
                  <div className="kicker">Step 1  /  Site and dates</div>
                  <h3>Pick a site, <em>then dates.</em></h3>
                </>
              )}

              <div className="row2">
                <div>
                  <label>Arrive</label>
                  <input type="date" value={arr} onChange={e => setArr(e.target.value)} />
                </div>
                <div>
                  <label>Depart</label>
                  <input type="date" value={dep} onChange={e => setDep(e.target.value)} />
                </div>
              </div>

              <div className="row2">
                <div>
                  <label>Setup</label>
                  <select value={rig} onChange={e => setRig(e.target.value)}>
                    <option>Tent</option>
                    <option>Van / Truck</option><option>Travel Trailer</option>
                    <option>Class C</option><option>Class A</option><option>Fifth Wheel</option>
                  </select>
                </div>
                <div>
                  <label>Travelers</label>
                  <input type="number" min="1" max="8" value={heads} onChange={e => setHeads(+e.target.value)} />
                </div>
              </div>
              <button className="cta" type="button" onClick={() => setStep('guest')} disabled={!siteReady}>
                Continue to guest details →
              </button>
            </>
          )}

          {step === 'guest' && (
            <>
              <div className="kicker">Step 2  /  Guest</div>
              <h3>Who should we <em>hold it for?</em></h3>
              <div className="row2 contact-row">
                <div>
                  <label>Name</label>
                  <input value={guest.name} onChange={e => updateGuest('name', e.target.value)} placeholder="Your name" />
                </div>
                <div>
                  <label>Phone</label>
                  <input value={guest.phone} onChange={e => updateGuest('phone', e.target.value)} placeholder="(509) 000-0000" />
                </div>
              </div>
              <div className="contact-row">
                <label>Email <span style={{ color:'var(--mute)', letterSpacing:'0.08em' }}>(optional)</span></label>
                <input type="email" value={guest.email} onChange={e => updateGuest('email', e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="form-actions">
                <button type="button" className="ghost-cta" onClick={() => setStep('site')}>Back</button>
                <button className="cta" type="button" onClick={() => setStep('review')} disabled={!guestReady}>Review and pay →</button>
              </div>
            </>
          )}

          {step === 'review' && (
            <>
              <div className="kicker">Step 3  /  Secure payment</div>
              <h3>Review, <em>then pay.</em></h3>
              <div className="review-card">
                <div><span>Site</span><strong>No. {String(selSite?.siteNumber || sel || '').padStart(2,'0')}</strong></div>
                <div><span>Dates</span><strong>{arr} to {dep}</strong></div>
                <div><span>Setup</span><strong>{rig} · {heads} guests</strong></div>
                <div><span>Guest</span><strong>{guest.name || 'Name required'}</strong></div>
              </div>
              <div className="pick" style={{ marginTop: 20 }}>
                <div><div className="det">Nights</div><div className="num">{nights}</div></div>
                <div style={{ textAlign:'right' }}><div className="det">Rate</div><div className="num">{money(rateCents)}<span style={{fontSize:11,color:'var(--mute)',fontFamily:'var(--mono)',marginLeft:4}}>/NT</span></div></div>
              </div>

              <div className="total">
                <div className="l">Estimated total</div>
                <div className="amt">{money(totalCents)}<small>USD</small></div>
              </div>

              <div className="form-actions">
                <button type="button" className="ghost-cta" onClick={() => setStep('guest')}>Back</button>
                <button className="cta" onClick={confirm} disabled={!ready || busy}>
                  {busy ? 'Preparing payment...' : `Pay and reserve site no. ${String(selSite?.siteNumber || sel).padStart(2,'0')} →`}
                </button>
              </div>
              {error && <div className="reserve-note" style={{ color: 'var(--oxide)' }}>{error}</div>}
              <div className="reserve-note">Square payment opens on this page. Your booking is confirmed after payment is complete.</div>
            </>
          )}

          {step !== 'review' && (
            <div className="reservation-mini-summary">
              <div>
                <span>Site</span>
                <strong>{selSite ? `No. ${String(selSite.siteNumber || selSite.id).padStart(2,'0')}` : 'Pick one'}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{money(totalCents)}</strong>
              </div>
            </div>
          )}
        </div>
      </div>

      {fuelPrices.length > 0 && <div className="pumps">
        <div>
          <div className="grade">{fuelPrices[0]?.label || 'Fuel'}</div>
          <div className="price">{fuelPrices[0]?.price.toFixed(2)}<small>/GAL</small></div>
          <div className="note">Live price from the store feed.</div>
        </div>
        {fuelPrices[1] && <div>
          <div className="grade">{fuelPrices[1].label}</div>
          <div className="price">{fuelPrices[1].price.toFixed(2)}<small>/GAL</small></div>
          <div className="note">Live price from the store feed.</div>
        </div>}
        <div>
          <div className="grade">Ice  /  Wood  /  Propane</div>
          <div className="price" style={{ fontSize: 64 }}>$4<small>/BAG</small></div>
          <div className="note">7-lb chip ice, hardwood bundles, 20-lb propane swap.</div>
        </div>
      </div>}

      {confirmed && (
        <div className="modal-bg" onClick={() => setConfirmed(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="x" onClick={() => setConfirmed(null)}>Close ✕</button>
            <h3>Booking <em>confirmed.</em></h3>
            <p>Your Square payment is complete and the RV site is confirmed.</p>
            <div className="receipt">
              <div className="r"><span className="l">Guest</span><span>{confirmed.guest.name}</span></div>
              <div className="r"><span className="l">Phone</span><span>{confirmed.guest.phone}</span></div>
              <div className="r"><span className="l">Site</span><span>No. {String(confirmed.site.siteNumber || confirmed.site.id).padStart(2,'0')}  ·  {confirmed.site.amp}</span></div>
              <div className="r"><span className="l">Arrive</span><span>{confirmed.arr}</span></div>
              <div className="r"><span className="l">Depart</span><span>{confirmed.dep}</span></div>
              <div className="r"><span className="l">Nights</span><span>{confirmed.nights} × {money(confirmed.site.nightlyPriceCents)}</span></div>
              <div className="r"><span className="l">Setup</span><span>{confirmed.rig}  ·  {confirmed.heads} guests</span></div>
              <div className="r" style={{ borderTop: '1px solid var(--rule)', paddingTop: 10, marginTop: 6 }}>
                <span className="l">Total</span><span style={{ fontFamily:'var(--serif)', fontSize: 22 }}>{money(confirmed.payment?.amountCents || confirmed.hold?.quote?.totalCents || 0)}</span>
              </div>
            </div>
            <div className="conf">Conf. {confirmed.bookingCode}</div>
            {phone && <a className="modal-call" href={telHref(phone)}>Call with questions →</a>}
          </div>
        </div>
      )}
      {paymentSession && (
        <SquarePaymentForm
          session={paymentSession}
          onPay={onPay}
          onCancel={() => setPaymentSession(null)}
          onSuccess={(paid) => {
            setPaymentSession(null);
            setConfirmed({
              ...paymentSession,
              booking: paid.booking,
              payment: paid.payment,
            });
          }}
        />
      )}
    </section>
  );
};

// ─── Events ──────────────────────────────────────────────────────────────
const Events = ({ events = EVENTS }) => {
  if (!events.length) return null;
  return (
  <section className="section reveal" id="events">
    <div className="head">
      <h2>Around the <em>fire.</em></h2>
      <p>The lot gets quieter after dark, mostly. Once or twice a month we make it less so. Bring a chair.</p>
    </div>
    <div className="events">
      {events.map((e, i) => (
        <div className="row" key={i}>
          <div className="date">{e.d}<small>{e.m}  ·  {e.day}</small></div>
          <div>
            <div className="title">{e.t}</div>
            <div className="meta">{e.meta}</div>
          </div>
          <button className="rsvp">RSVP →</button>
        </div>
      ))}
    </div>
  </section>
  );
};

// ─── Instagram ───────────────────────────────────────────────────────────
const Instagram = ({ settings = {} }) => {
  const section = (settings.sections || []).find(item => item.key === 'instagram');
  const sectionPosts = (section?.items || []).map((item, index) => ({
    title: item.title || item.name || `Midway update ${index + 1}`,
    caption: item.description || item.copy || item.date || 'A quick look at what is happening at Midway.',
    image: item.image || item.imageUrl || ['/images/store-interior.jpg', '/images/store-exterior.jpg', '/images/exterior-wide.jpg', '/images/exterior-detailed.jpg'][index % 4],
  }));
  const linkedPosts = Array.isArray(settings.instagramPosts)
    ? settings.instagramPosts.filter(Boolean).slice(0, 6).map((postUrl, index) => ({
        title: `Midway post ${String(index + 1).padStart(2, '0')}`,
        caption: instagramPostCaption(postUrl),
        image: ['/images/store-interior.jpg', '/images/store-exterior.jpg', '/images/exterior-wide.jpg', '/images/exterior-detailed.jpg'][index % 4],
      }))
    : [];
  const posts = (sectionPosts.length ? sectionPosts : linkedPosts).slice(0, 6);
  if (posts.length === 0) return null;

  return (
    <section className="section reveal instagram-section" id="instagram">
      <div className="head">
        <h2>{section?.title || <>Fresh from <em>Midway.</em></>}</h2>
        <p>{section?.copy || 'Store updates, seasonal road notes, new arrivals, and RV site moments shown as first-party content instead of a fragile social embed.'}</p>
      </div>
      <div className="instagram-gallery" aria-label="Midway Instagram gallery">
        {posts.map((post, index) => (
          <article className="instagram-card" key={`${post.title}-${index}`}>
            <img src={post.image} alt="" loading="lazy" />
            <div>
              <span>Post {String(index + 1).padStart(2, '0')}</span>
              <h3>{post.title}</h3>
              <p>{post.caption}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

function instagramPostCaption(postUrl = '') {
  const cleaned = String(postUrl).replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
  return cleaned ? `Imported from ${cleaned}. Add title and copy in Admin section controls when you want this card to read like a finished story.` : 'Imported Midway post.';
}

// ─── Find us ─────────────────────────────────────────────────────────────
const Find = ({ phone = '', address = '', hours = [] }) => {
  const rows = normalizedHours(hours);
  const mapSrc = address ? `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed` : '';
  return (
    <section className="section reveal" id="find" style={{ background: 'var(--paper)' }}>
      <div className="head">
        <h2>Find <em>us.</em></h2>
        <p>Midway sits at 14193 Chiwawa Loop RD in Leavenworth, just outside Plain and close to the road into Lake Wenatchee.</p>
      </div>
      <div className="find">
        <div className="map">
          {mapSrc && <iframe title="Map to Midway Gas & Grocery" src={mapSrc} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
      </div>
        <div className="hours">
          {rows.length > 0 && <div className="eyebrow" style={{ marginBottom: 16 }}>Hours</div>}
          {rows.map(row => (
            <div className="h-row" key={row.day}>
              <span>{DAY_LABELS[row.day] || row.day}</span>
              <span className="t">{hourLabel(row)}</span>
            </div>
          ))}
          <div style={{ marginTop: 32, display:'grid', gap: 10 }}>
            <div className="eyebrow">Contact</div>
            {phone && <div style={{ fontFamily:'var(--serif)', fontSize: 26 }}>{phone}</div>}
            {address && <div style={{ fontFamily:'var(--mono)', fontSize: 12 }}>{address}</div>}
          </div>
        </div>
      </div>
    </section>
  );
};

// ─── Footer ──────────────────────────────────────────────────────────────
const Foot = ({ visible = {}, phone = '', address = '' }) => (
  <footer className="foot">
    <img src="/assets/midway-logo.png" alt="Midway" className="wm" />
    <div className="foot-cols">
      <div>
        <h4>The Store</h4>
        <a href="#today">Hours &amp; status</a>
        {visible.coffee && <a href="#coffee">Coffee</a>}
        {visible.products && <a href="#pantry">Pantry &amp; provisions</a>}
        {visible.rvBooking && <a href="#stay">Book Site</a>}
        {visible.instagram && <a href="#instagram">Instagram</a>}
      </div>
      <div>
        <h4>Visit</h4>
        {visible.events && <a href="#events">Events</a>}
        <a href="#find">Find Us</a>
        {address && <a href={directionsHref(address)} target="_blank" rel="noreferrer">Directions</a>}
      </div>
      <div>
        <h4>Reach Us</h4>
        {phone && <a href={telHref(phone)}>{phone}</a>}
        {address && <p>{address}</p>}
      </div>
      <div>
        <h4>Local stop</h4>
        <p>Fuel, espresso, bait, tackle, ice, firewood, groceries, RV sites, and tent areas in Plain, Washington.</p>
        <a href="/admin.html" className="footer-admin-link">Admin login</a>
      </div>
    </div>
    <div className="foot-bot">
      <div>© Midway Gas &amp; Grocery  ·  Plain, WA</div>
      <div>Built slow, in Plain.</div>
    </div>
  </footer>
);

// ─── App ─────────────────────────────────────────────────────────────────
const App = () => {
  const [bootstrap, setBootstrap] = useState(emptyBootstrap);
  const [availabilityIds, setAvailabilityIds] = useState(null);
  const sites = useMemo(() => {
    const ids = availabilityIds ? new Set(availabilityIds) : null;
    return (bootstrap.rvSites || []).map(site => toMapSite(site, ids));
  }, [bootstrap.rvSites, availabilityIds]);

  const loadBootstrap = async (range = {}) => {
    try {
      const query = range.startDate && range.endDate
        ? `?startDate=${encodeURIComponent(range.startDate)}&endDate=${encodeURIComponent(range.endDate)}`
        : '';
      const data = await api(`/public/bootstrap${query}`);
      setBootstrap(data);
      if (range.startDate && range.endDate) setAvailabilityIds(data.rvAvailability || []);
    } catch (err) {
      console.warn('[Midway] Public bootstrap unavailable.', err);
    }
  };

  useEffect(() => {
    loadBootstrap();
  }, []);

  const startCheckout = async (payload) => api('/bookings/checkout', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      customerSessionId: getCustomerSessionId(),
    }),
  });

  const payBooking = async (payload) => api('/bookings/pay', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  useReveal();

  const jumpStay = () => document.getElementById('stay')?.scrollIntoView({ behavior:'smooth', block:'start' });
  const visibleSections = {
    coffee: !!(bootstrap.featureFlags?.coffee && Object.keys(bootstrap.coffeeMenu || {}).length),
    products: !!(bootstrap.featureFlags?.products && (bootstrap.products || []).length),
    rvBooking: !!bootstrap.featureFlags?.rvBooking,
    events: !!(bootstrap.featureFlags?.events && (bootstrap.events || []).length),
    instagram: !!bootstrap.featureFlags?.instagram,
  };
  return (
    <>
      <Nav visible={visibleSections} phone={bootstrap.settings?.phone} address={bootstrap.settings?.address} />
      <Hero flags={bootstrap.featureFlags} phone={bootstrap.settings?.phone} address={bootstrap.settings?.address} hours={bootstrap.hours || []} />
      <Ticker onJumpStay={jumpStay} sites={sites} bootstrap={bootstrap} />
      {visibleSections.coffee && <Coffee menu={bootstrap.coffeeMenu || COFFEE} />}
      {visibleSections.products && <Pantry products={bootstrap.products || []} />}
      {visibleSections.rvBooking && (
        <Stay
          sites={sites}
          fuelPrices={bootstrap.fuelPrices || []}
          phone={bootstrap.settings?.phone}
          onCheckout={startCheckout}
          onPay={payBooking}
          onDateRangeChange={(startDate, endDate) => loadBootstrap({ startDate, endDate })}
        />
      )}
      {visibleSections.events && <Events events={bootstrap.events || []} />}
      {visibleSections.instagram && <Instagram settings={bootstrap.settings || {}} />}
      <Find phone={bootstrap.settings?.phone} address={bootstrap.settings?.address} hours={bootstrap.hours || []} />
      <Foot
        phone={bootstrap.settings?.phone}
        address={bootstrap.settings?.address}
        visible={visibleSections}
      />
    </>
  );
};

function getCustomerSessionId() {
  const key = 'midway_customer_session_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || `browser-${Date.now()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

createRoot(document.getElementById('root')).render(<App />);
