/* global Square */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  addLocalDateDays,
  buildSquarePaymentRequest,
  buildSquareVerificationDetails,
  checkoutAmountCents,
  createPaymentIdempotencyKey,
  dateRangeNights,
  normalizeDepartureDate,
} from './lib/public-checkout.js';
import { bookableMapSites as STATIC_RV_SITES, denormalizeMapSite } from './lib/rv-map-data.js';

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
const FALLBACK_INSTAGRAM_SECTION = {
  key: 'instagram',
  enabled: true,
  title: 'Fresh from Midway.',
  copy: 'Live updates from the Midway Instagram account.',
  items: [],
};
const FALLBACK_SETTINGS = {
  businessName: 'Midway Gas & Grocery',
  phone: '(509) 596-1076',
  address: '14193 Chiwawa Loop RD, Leavenworth, WA 98826',
  timezone: 'America/Los_Angeles',
  instagramHandle: 'midwaygrocer',
  instagramUrl: 'https://www.instagram.com/midwaygrocer/',
  instagramFeed: [],
  sections: [FALLBACK_INSTAGRAM_SECTION],
};
const FALLBACK_HOURS = [
  { day: 'monday', open: '8:00 AM', close: '5:00 PM' },
  { day: 'tuesday', closed: true },
  { day: 'wednesday', closed: true },
  { day: 'thursday', open: '7:00 AM', close: '7:00 PM' },
  { day: 'friday', open: '7:00 AM', close: '7:00 PM' },
  { day: 'saturday', open: '7:00 AM', close: '7:00 PM' },
  { day: 'sunday', open: '8:00 AM', close: '5:00 PM' },
];

// First day of the 2026 season. Before this date the store shows "Opens Thu, Jun 19".
const SEASON_OPEN_DATE = '2026-06-19';
const beforeSeason = new Date().toISOString().slice(0, 10) < SEASON_OPEN_DATE;
const FALLBACK_RV_SITES = STATIC_RV_SITES.map(site => {
  const denormalized = denormalizeMapSite(site);
  return {
    ...denormalized,
    type: denormalized.type === 'back-in' ? 'back' : denormalized.type,
  };
});

const toMapSite = (site, availableIds = null) => ({
  id: site.id,
  siteNumber: site.siteNumber,
  x: site.mapX,
  y: site.mapY,
  w: site.mapWidth,
  h: site.mapHeight,
  rot: site.rotation || 0,
  amp: site.amp,
  hookup: site.hookup,
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
const MIDWAY_COORDS = '47.8188945,-120.7082358';
const GOOGLE_MAPS_EMBED_KEY = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const GOOGLE_MAPS_SHARE_EMBED_SRC = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2411.556640884445!2d-120.7109064!3d47.8186347!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x549b013d8d72a3dd%3A0x62d1c691d25b6866!2s14193%20Chiwawa%20Loop%20Road%2C%20Leavenworth%2C%20WA%2098826!5e1!3m2!1sen!2sus!4v1710000000000!5m2!1sen!2sus';
const mapEmbedHref = (address = '') => {
  if (!GOOGLE_MAPS_EMBED_KEY) return GOOGLE_MAPS_SHARE_EMBED_SRC;
  return 'https://www.google.com/maps/embed/v1/place'
    + `?key=${encodeURIComponent(GOOGLE_MAPS_EMBED_KEY)}`
    + `&q=${encodeURIComponent(address || MIDWAY_COORDS)}`
    + `&center=${MIDWAY_COORDS}`
    + '&zoom=18&maptype=satellite';
};
const dateInput = (offsetDays) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

const normalizeHour = (hour = {}) => {
  const day = String(hour.day || hour.dayOfWeek || '').toLowerCase();
  if (!day) return null;
  const open = hour.open || hour.openTime || hour.open_time || '';
  const close = hour.close || hour.closeTime || hour.close_time || '';
  const closed = hour.closed === true || (!open && !close);
  if (closed) return { day, closed: true };
  if (!open || !close) return null;
  return { day, open, close };
};

const normalizedHours = (hours = []) => hours
  .map(normalizeHour)
  .filter(Boolean)
  .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));

const todayHour = (hours = []) => {
  const today = DAY_ORDER[new Date().getDay()];
  return normalizedHours(hours).find(hour => hour.day === today) || null;
};

const hourLabel = (hour) => {
  if (!hour) return '';
  if (hour.closed) return 'Closed';
  return `${hour.open} - ${hour.close}`;
};
// "8:00 AM" / "7:00 PM" → "8–7" for the compact today-strip cell.
const compactHour = (hour) => {
  if (!hour || hour.closed) return 'Closed';
  const h = (t = '') => (String(t).match(/\d{1,2}/) || ['?'])[0];
  return `${h(hour.open)}–${h(hour.close)}`;
};
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
const RV_RULES = [
  'RV sites are to be left clean.',
  'Campfires are allowed in provided fire pits only, when allowed.',
  'Picnic tables are not to be moved from site to site without permission.',
  'Pets are not allowed in cabins. No exceptions.',
  'Pets are allowed in your RV, but must be kept on a leash at all times when outside. You are responsible if your pet bites, and animals must be cleaned up after. Please do not let pets use the grass as a restroom.',
  'One vehicle and one tent are included per site. A second vehicle is $10 per night.',
  'Noise must be kept to a minimum. Quiet time begins at 10:00 PM.',
  'Off-road vehicles must be driven safely and slowly inside the park.',
  'The speed limit is under 5 MPH at all times for all drivers.',
  'Renters shall leave a credit card number for any damage caused.',
  'No fireworks.',
  'Alcohol is allowed in the RV park only.',
];
const RV_WAIVER_TEXT = 'I hereby waive and release, indemnify, hold harmless, and forever discharge Midway Village and Grocery and its agents, employees, affiliates, managers, volunteers, successors, and assigns of any and all claims, demands, debts, contracts, expenses, causes of action, lawsuits, damages, and liabilities of every kind and nature, whether known or unknown, in law or equity, that I ever had or may have arising from or in any way related to my participation in events or activities conducted by, on the premises of, or for the benefit of Midway Village and Grocery. This waiver does not apply to acts of gross negligence or intentional, willful, or wanton misconduct. By this waiver I assume any risk, take full responsibility, and waive any claims of personal injury, death, or damage to personal property associated with Midway Village and Grocery. I further agree that I and my party, guests, and friends will follow and respect all rules above and assume responsibility for watching and caring for minors, including guarding against all natural or man-made hazards whether expressly mentioned in this waiver and release or not.';

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

const SquareMark = () => (
  <span className="square-mark" aria-label="Square checkout">
    <span className="square-mark__icon" aria-hidden="true" />
    <span>Square checkout</span>
  </span>
);

// ─── Scroll reveal hook ────────────────────────────────────────────────────
const useReveal = () => {
  useEffect(() => {
    const observed = new WeakSet();
    const io = new IntersectionObserver((es) => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0, rootMargin: '0px 0px -40px 0px' });

    const observeReveals = (root = document) => {
      root.querySelectorAll?.('.reveal').forEach(el => {
        if (observed.has(el) || el.classList.contains('in')) return;
        observed.add(el);
        io.observe(el);
      });
    };

    observeReveals();

    // Scroll-position fallback: IntersectionObserver can fail to fire for very
    // tall sections or in headless/odd-viewport contexts, leaving content stuck
    // at opacity:0. This guarantees anything reaching the viewport reveals.
    const revealInView = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      document.querySelectorAll('.reveal:not(.in)').forEach(el => {
        if (el.getBoundingClientRect().top < vh - 20) el.classList.add('in');
      });
    };
    revealInView();
    window.addEventListener('scroll', revealInView, { passive: true });
    window.addEventListener('resize', revealInView);

    const mutations = new MutationObserver(entries => {
      entries.forEach(entry => {
        entry.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (node.matches?.('.reveal') && !observed.has(node) && !node.classList.contains('in')) {
            observed.add(node);
            io.observe(node);
          }
          observeReveals(node);
        });
      });
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutations.disconnect();
      io.disconnect();
      window.removeEventListener('scroll', revealInView);
      window.removeEventListener('resize', revealInView);
    };
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
        {visible.products && <a href="#order">Order Ahead</a>}
        {visible.coffee && <a href="#coffee">Coffee</a>}
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
const Hero = ({ flags = {}, hours = [] }) => {
  const today = todayHour(hours);
  const statusLabel = beforeSeason
    ? 'Opens Thu, Jun 19'
    : (today && !today.closed ? `Store open · ${hourLabel(today)}` : (today?.closed ? 'Closed today' : 'Store hours vary'));
  return (
    <header id="top" className="hero hero-redesign">
      <img className="hero-bg" src="/images/store-dusk.jpg" alt="Midway Gas & Grocery storefront at dusk in Plain, Washington" />
      <div className="hero-shade" aria-hidden="true" />
      <div className="hero-copy">
        <div className="hero-status">
          <span className="hero-status-open"><i /> {statusLabel}</span>
          <span className="hero-status-sep">/</span>
          <span className="hero-status-gas">Gas 24/7</span>
        </div>
        <h1 className="hero-headline">Gas, coffee, ice cream, and the essentials.</h1>
        <p className="hero-lede">Your stop on Chiwawa Loop Road for 24/7 fuel, espresso and soft serve, real groceries, and full-hookup campsites — in Plain, Washington.</p>
        <div className="hero-actions">
          {flags.rvBooking && <a href="#stay" className="hero-link hero-primary">Book a site <span>→</span></a>}
          {flags.products && <a href="#order" className="hero-link hero-secondary">Order this week</a>}
        </div>
      </div>
    </header>
  );
};

// ─── Live ticker ──────────────────────────────────────────────────────────
const Ticker = ({ onJumpStay, sites, bootstrap }) => {
  const openCount = sites.filter(s => !s.taken).length;
  const fuel = bootstrap.fuelPrices || [];
  const today = todayHour(bootstrap.hours || []);
  const hasFuel = Boolean(bootstrap.featureFlags?.fuel && fuel.length);
  const hasRvBooking = Boolean(bootstrap.featureFlags?.rvBooking && sites.length);
  const nonEthanol = fuel.find(p => p.type === 'unleaded') || fuel[0];
  return (
    <section id="today" className="ticker today-strip">
      {today && (
        <div>
          <div className="l">Store today</div>
          <div className="v">{beforeSeason ? 'Closed' : compactHour(today)}</div>
          <div className="s">{beforeSeason ? 'Opens Thu, Jun 19' : (today.closed ? 'Closed today' : hourLabel(today))}</div>
        </div>
      )}
      <div className="gas">
        <div className="l">Gas · pay at pump</div>
        <div className="v accent">24/7</div>
        <div className="s">Always open at the pump</div>
      </div>
      {hasFuel && nonEthanol && (
        <div>
          <div className="l">{nonEthanol.label}</div>
          <div className="v">${nonEthanol.price.toFixed(2)}<small>/gal</small></div>
          <div className="s">Live store price</div>
        </div>
      )}
      {hasRvBooking && (
        <div className="open" onClick={onJumpStay}>
          <div className="l">Camp sites open</div>
          <div className="v">{openCount}<small>/{sites.length}</small></div>
          <div className="s">Tap to book →</div>
        </div>
      )}
    </section>
  );
};

// ─── Marquee ──────────────────────────────────────────────────────────────
const MARQUEE_ITEMS = ['24/7 fuel', 'diesel', 'espresso', 'soft serve', 'scoop ice cream', 'groceries', 'beer & wine', 'bait & tackle', 'rv sites', 'ice', 'firewood', 'propane', 'plain, washington'];
const Marquee = () => (
  <div className="marquee">
    <div className="marquee-track">
      {[...Array(2)].map((_, k) => (
        <React.Fragment key={k}>
          {MARQUEE_ITEMS.map((item, i) => <span key={`${k}-${i}`}>{item}</span>)}
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
              <div className="p">{it.p}</div>
              {it.d && <div className="d">{it.d}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  </section>
  );
};

// ─── Order ahead (Square catalog → cart → Square checkout) ──────────────────
const OrderPaymentForm = ({ session, customer, lines, onPay, onSuccess, onCancel }) => {
  const cardId = useMemo(() => `order-card-${session.orderCode}`, [session.orderCode]);
  const [card, setCard] = useState(null);
  const [payments, setPayments] = useState(null);
  const [status, setStatus] = useState('Preparing secure payment…');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checkout = session.checkout || {};
  const amountCents = session.amountCents;

  useEffect(() => {
    let disposed = false;
    let mounted = null;
    (async () => {
      try {
        const square = await loadSquareSdk(checkout.environment);
        if (!square?.payments) throw new Error('Square payment form is unavailable.');
        const client = square.payments(checkout.applicationId, checkout.locationId);
        mounted = await client.card();
        await mounted.attach(`#${cardId}`);
        if (disposed) { mounted.destroy?.(); return; }
        setPayments(client);
        setCard(mounted);
        setStatus('Secure card form ready.');
      } catch (err) {
        setError(err.message || 'Square payment form is unavailable.');
        setStatus('');
      }
    })();
    return () => { disposed = true; mounted?.destroy?.(); };
  }, [checkout.environment, checkout.applicationId, checkout.locationId, cardId]);

  const submit = async () => {
    if (busy || !card) return;
    setBusy(true);
    setError('');
    try {
      const result = await card.tokenize();
      if (result.status !== 'OK') {
        throw new Error(result.errors?.map(e => e.message).filter(Boolean).join(' ') || 'Card details could not be verified.');
      }
      let verificationToken = null;
      if (payments?.verifyBuyer) {
        const verification = await payments.verifyBuyer(result.token, buildSquareVerificationDetails({ checkout, session: { guest: customer }, amountCents }));
        verificationToken = verification?.token || null;
      }
      const paid = await onPay({
        orderId: session.orderId,
        orderCode: session.orderCode,
        sourceId: result.token,
        verificationToken,
        idempotencyKey: createPaymentIdempotencyKey(session.orderCode, 'order'),
        customer,
        itemsSummary: lines.map(l => ({ name: l.p.name, quantity: l.qty, lineCents: l.p.priceCents * l.qty })),
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
        <button className="x" type="button" onClick={onCancel}>Close</button>
        <div className="payment-brand-row"><SquareMark /><span>Encrypted payment</span></div>
        <h3>Pay <em>securely.</em></h3>
        <p>Order {session.orderCode} · pickup Wednesday afternoon at the counter.</p>
        <div className="payment-summary"><span>{session.orderCode}</span><strong>{moneyExact(amountCents)}</strong></div>
        <div id={cardId} className="square-card-host" />
        {status && <div className="reserve-note" aria-live="polite">{status}</div>}
        {error && <div className="reserve-note" aria-live="polite" style={{ color: 'var(--oxide)' }}>{error}</div>}
        <button className="cta payment-submit" type="button" onClick={submit} disabled={busy || !card}>
          {busy ? 'Processing payment…' : `Pay ${moneyExact(amountCents)}`}
        </button>
      </div>
    </div>
  );
};

const OrderAhead = ({ products = [], onCheckout, onPay }) => {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState({});
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  const [session, setSession] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const byId = useMemo(() => new Map(products.map(p => [p.variationId || p.id, p])), [products]);
  const cats = useMemo(() => ['All', ...Array.from(new Set(products.map(p => p.category || 'Store')))], [products]);
  const filtered = useMemo(() => products.filter(p => {
    const c = p.category || 'Store';
    const matchC = cat === 'All' || c === cat;
    const matchQ = !q || (p.name + ' ' + c).toLowerCase().includes(q.toLowerCase());
    return matchC && matchQ;
  }), [products, q, cat]);
  const lines = useMemo(() => Object.entries(cart)
    .map(([id, qty]) => { const p = byId.get(id); return p ? { id, qty, p } : null; })
    .filter(Boolean), [cart, byId]);
  const totalCents = lines.reduce((s, l) => s + l.p.priceCents * l.qty, 0);
  const cartCount = lines.reduce((s, l) => s + l.qty, 0);
  const hasCart = lines.length > 0;

  const PAGE_SIZE = 18;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [q, cat]);

  if (!products.length) return null;

  const add = (id) => { setCart(c => ({ ...c, [id]: (c[id] || 0) + 1 })); setError(''); };
  const remove = (id) => setCart(c => { const n = { ...c }; const q = (n[id] || 0) - 1; if (q > 0) n[id] = q; else delete n[id]; return n; });
  const removeLine = (id) => setCart(c => { const n = { ...c }; delete n[id]; return n; });
  const clearCart = () => { setCart({}); setError(''); };

  const startCheckout = async () => {
    if (!hasCart || busy) return;
    if (!customer.name.trim() || !customer.email.trim()) { setError('Add your name and email for the pickup confirmation.'); return; }
    setBusy(true);
    setError('');
    try {
      const data = await onCheckout({ items: lines.map(l => ({ variationId: l.id, quantity: l.qty })), customer });
      setSession(data);
    } catch (err) {
      setError(err.message || 'Could not start checkout right now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section reveal" id="order">
      <div className="order-head">
        <div className="eyebrow" style={{ color: 'var(--oxide)' }}>New — weekly grocery order-ahead</div>
        <h2>Order by Monday noon. <em>Pick it up Wednesday.</em></h2>
        <p>Build your box from the Midway shelves and check out with Square by Monday at 12 PM. We shop and pack it midweek — ready at the counter Wednesday afternoon. Pickup only, every week.</p>
      </div>

      <div className="order-tools">
        <div className="pantry-search">
          <span className="ic">⌕</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the pantry — coffee, ice, bait…" />
          {q && <button onClick={() => setQ('')} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--mute)' }}>clear ✕</button>}
        </div>
        <div className="pantry-chips">
          {cats.map(c => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
        </div>
      </div>
      <div className="pantry-count">
        {filtered.length === 0
          ? `0 of ${products.length} products`
          : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}${cat === 'All' ? '' : ` in ${cat}`}`}
      </div>

      <div className="order-layout">
        <div className="order-grid-wrap">
        <div className="order-grid">
          {filtered.length === 0 && <div className="pantry-empty">Nothing matches — try the chips above.</div>}
          {pageItems.map(p => {
            const id = p.variationId || p.id;
            const qty = cart[id] || 0;
            return (
              <div className="order-card" key={id}>
                <div className="order-card-ph">
                  {p.imageUrl
                    ? <img className="order-card-img" src={p.imageUrl} alt="" loading="lazy" onError={e => { e.currentTarget.remove(); }} />
                    : <span className="order-card-ph-label">{p.category || 'Store'}</span>}
                  {qty > 0 && <span className="order-qty">{qty}</span>}
                </div>
                <div className="order-card-body">
                  <div className="order-card-name">{p.name}</div>
                  <div className="order-card-cat">{p.category || 'Store'}</div>
                  <div className="order-card-foot">
                    <span className="order-card-price">{moneyExact(p.priceCents)}</span>
                    <button className="order-add" onClick={() => add(id)}>Add +</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {pageCount > 1 && (
          <div className="order-pager">
            <button className="order-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>← Prev</button>
            <span className="order-page-label">Page {safePage} of {pageCount}</span>
            <button className="order-page-btn" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount}>Next →</button>
          </div>
        )}
        </div>

        <aside className="order-cart">
          <div className="order-cart-head">
            <span>Your weekly box</span>
            {hasCart
              ? <button className="order-cart-clear" onClick={clearCart}>Clear</button>
              : <span className="order-cart-count">Empty</span>}
          </div>
          {hasCart ? (
            <>
              <div className="order-cart-lines">
                {lines.map(l => (
                  <div className="order-cart-line" key={l.id}>
                    <div className="order-line-info">
                      <span className="order-line-name">{l.p.name}</span>
                      <span className="order-line-price">{moneyExact(l.p.priceCents * l.qty)}</span>
                    </div>
                    <div className="order-line-controls">
                      <div className="order-qty-stepper">
                        <button onClick={() => remove(l.id)} aria-label="Remove one">−</button>
                        <span className="order-qty-num">{l.qty}</span>
                        <button onClick={() => add(l.id)} aria-label="Add one">+</button>
                      </div>
                      <button className="order-line-remove" onClick={() => removeLine(l.id)} aria-label="Remove item">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="order-total"><span>Total</span><strong>{moneyExact(totalCents)}</strong></div>
              <div className="order-fields">
                <input placeholder="Name" value={customer.name} onChange={e => setCustomer(c => ({ ...c, name: e.target.value }))} />
                <input placeholder="Mobile — for the ready text" value={customer.phone} onChange={e => setCustomer(c => ({ ...c, phone: e.target.value }))} />
                <input placeholder="Email — for the receipt" type="email" value={customer.email} onChange={e => setCustomer(c => ({ ...c, email: e.target.value }))} />
              </div>
              <div className="order-pickup">Pickup Wed afternoon · at the counter</div>
              <button className="cta" onClick={startCheckout} disabled={busy}>{busy ? 'Starting…' : 'Checkout with Square →'}</button>
              {error && <div className="reserve-note" style={{ color: 'var(--oxide)' }}>{error}</div>}
              <div className="order-cart-note">Order by Mon 12 PM · pickup Wed · no delivery.</div>
            </>
          ) : (
            <div className="order-cart-empty">Your box is empty.<br />Add provisions to start →</div>
          )}
        </aside>
      </div>

      {session && (
        <OrderPaymentForm
          session={session}
          customer={customer}
          lines={lines}
          onPay={onPay}
          onCancel={() => setSession(null)}
          onSuccess={(paid) => { setSession(null); setConfirmed(paid); setCart({}); }}
        />
      )}

      {confirmed && (
        <div className="modal-bg" onClick={() => setConfirmed(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="x" onClick={() => setConfirmed(null)}>Close ✕</button>
            <h3>Order <em>received.</em></h3>
            <p>Your Square payment is complete. We'll have your box packed for pickup Wednesday afternoon at the counter — check your email for the receipt.</p>
            <div className="conf">Conf. {confirmed.orderCode}</div>
          </div>
        </div>
      )}
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
const SitePlan = ({ sel, setSel, sites }) => {
  const sitePlanRef = useRef(null);
  const stageRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const draggedRef = useRef(false);
  const movedRef = useRef(false);
  // Zoom/pan live in refs and are written straight to the SVG group's transform
  // via requestAnimationFrame — no React re-render of the (hundreds of) map nodes
  // per wheel/pinch tick, which keeps trackpad zoom smooth.
  const worldRef = useRef(null);
  const viewRef = useRef({ zoom: 1, x: 0, y: 0 });
  const rafRef = useRef(0);
  const selectedIds = Array.isArray(sel) ? sel : (sel ? [sel] : []);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds.join('|')]);

  const clampView = (zoom, x, y) => ({
    zoom,
    x: clamp(x, -1200 * (zoom - 1), 0),
    y: clamp(y, -800 * (zoom - 1), 0),
  });
  const applyTransform = () => {
    const v = viewRef.current;
    worldRef.current?.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.zoom})`);
  };
  const scheduleApply = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; applyTransform(); });
  };
  const setView = (zoom, x, y) => { viewRef.current = clampView(zoom, x, y); scheduleApply(); };
  const pointInViewBox = (clientX, clientY) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 600, y: 400 };
    return {
      x: ((clientX - rect.left) / rect.width) * 1200,
      y: ((clientY - rect.top) / rect.height) * 800,
    };
  };
  const zoomAt = (clientX, clientY, nextZoom) => {
    const v = viewRef.current;
    const targetZoom = clamp(nextZoom, 1, 4);
    if (targetZoom === v.zoom) return;
    const focal = pointInViewBox(clientX, clientY);
    const ratio = targetZoom / v.zoom;
    setView(targetZoom, focal.x - (focal.x - v.x) * ratio, focal.y - (focal.y - v.y) * ratio);
  };
  const pointerDistance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const pointerCenter = (a, b) => ({
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
  });
  const onWheel = (event) => {
    event.preventDefault();
    // exponential factor = smooth, consistent zoom regardless of delta magnitude
    // Mac trackpad pinch arrives as ctrl+wheel with tiny deltas — needs a much
    // larger multiplier than a mouse wheel to feel responsive.
    const intensity = event.ctrlKey ? 0.015 : 0.0025;
    zoomAt(event.clientX, event.clientY, viewRef.current.zoom * Math.exp(-event.deltaY * intensity));
  };
  useEffect(() => {
    const sitePlan = sitePlanRef.current;
    if (!sitePlan) return undefined;
    applyTransform();
    sitePlan.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      sitePlan.removeEventListener('wheel', onWheel);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);
  const onPointerDown = (event) => {
    draggedRef.current = false;
    movedRef.current = false;
    pointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
    const pointers = Array.from(pointersRef.current.values());
    const v = viewRef.current;
    if (pointers.length >= 2) {
      const [first, second] = pointers;
      const center = pointerCenter(first, second);
      gestureRef.current = {
        mode: 'pinch',
        startDistance: pointerDistance(first, second),
        startZoom: v.zoom,
        startPan: { x: v.x, y: v.y },
        startCenter: pointInViewBox(center.clientX, center.clientY),
      };
    } else {
      gestureRef.current = {
        mode: 'pan',
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPan: { x: v.x, y: v.y },
      };
    }
  };
  const onPointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const gesture = gestureRef.current;
    if (!gesture) return;
    const movement = gesture.mode === 'pan'
      ? Math.hypot(event.clientX - gesture.startClientX, event.clientY - gesture.startClientY)
      : 8;
    if (movement > 5) {
      draggedRef.current = true;
      movedRef.current = true;
    }
    pointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
    const rect = stageRef.current?.getBoundingClientRect();
    if (!gesture || !rect) return;
    const pointers = Array.from(pointersRef.current.values());
    if (gesture.mode === 'pinch' && pointers.length >= 2) {
      const [first, second] = pointers;
      const nextZoom = clamp(gesture.startZoom * (pointerDistance(first, second) / gesture.startDistance), 1, 4);
      const ratio = nextZoom / gesture.startZoom;
      setView(nextZoom,
        gesture.startCenter.x - (gesture.startCenter.x - gesture.startPan.x) * ratio,
        gesture.startCenter.y - (gesture.startCenter.y - gesture.startPan.y) * ratio);
      return;
    }
    if (gesture.mode === 'pan' && pointers.length === 1) {
      const dx = ((event.clientX - gesture.startClientX) / rect.width) * 1200;
      const dy = ((event.clientY - gesture.startClientY) / rect.height) * 800;
      setView(viewRef.current.zoom, gesture.startPan.x + dx, gesture.startPan.y + dy);
    }
  };
  const onPointerUp = (event) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 1) {
      const [remaining] = Array.from(pointersRef.current.values());
      gestureRef.current = {
        mode: 'pan',
        startClientX: remaining.clientX,
        startClientY: remaining.clientY,
        startPan: { x: viewRef.current.x, y: viewRef.current.y },
      };
    } else if (pointersRef.current.size === 0) {
      gestureRef.current = null;
    }
    window.setTimeout(() => {
      draggedRef.current = false;
      movedRef.current = false;
    }, 0);
  };
  const toggleSite = (siteId) => {
    setSel(current => {
      const currentIds = Array.isArray(current) ? current : (current ? [current] : []);
      return currentIds.includes(siteId)
        ? currentIds.filter(id => id !== siteId)
        : [...currentIds, siteId];
    });
  };

  const tree = (x, y, s = 1) => (
    <path key={`t${x}${y}`} d={`M${x} ${y-12*s} L${x-9*s} ${y+10*s} L${x-4*s} ${y+10*s} L${x-12*s} ${y+22*s} L${x-4*s} ${y+22*s} L${x-9*s} ${y+30*s} L${x+9*s} ${y+30*s} L${x+4*s} ${y+22*s} L${x+12*s} ${y+22*s} L${x+4*s} ${y+10*s} L${x+9*s} ${y+10*s} Z`}
       fill="#4A4936" opacity="0.42" />
  );

  return (
    <div
      ref={sitePlanRef}
      className="siteplan"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg ref={stageRef} className="stage" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="forest" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M30 8 L22 28 L26 28 L18 42 L26 42 L22 52 L38 52 L34 42 L42 42 L34 28 L38 28 Z" fill="#4A4936" opacity=".22"/>
          </pattern>
          <pattern id="water" x="0" y="0" width="40" height="14" patternUnits="userSpaceOnUse">
            <path d="M0 7 Q10 0 20 7 T40 7" stroke="#8AA39A" strokeWidth="1.2" fill="none" opacity=".7"/>
          </pattern>
          <pattern id="takenHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="rgba(237,231,215,0.88)" />
            <path d="M0 0 L0 8" stroke="#7A776E" strokeWidth="2" opacity="0.72" />
          </pattern>
        </defs>

        <g className="map-world" ref={worldRef} transform="translate(0 0) scale(1)">
        <rect x="-360" y="-260" width="1920" height="1320" fill="#17171A"/>
        <rect x="-360" y="-260" width="1920" height="1320" fill="url(#forest)" opacity="0.5"/>

        {/* Store drive and RV loop */}
        <path d="M-80 150 L560 -42" stroke="#2A2925" strokeWidth="56" fill="none" strokeLinecap="round" opacity="0.9"/>
        <path d="M-80 150 L560 -42" stroke="#EDE7D7" strokeWidth="2" strokeDasharray="18 18" fill="none" opacity="0.8"/>
        <text x="84" y="106" fontFamily="JetBrains Mono" fontSize="11" letterSpacing="2" fill="#A6A49C" transform="rotate(-17 84 106)">CHIWAWA LOOP RD</text>

        <path d="M286 158 C318 232 346 266 372 300" stroke="#11100E" strokeWidth="32" fill="none" strokeLinecap="round" opacity="0.82"/>
        <path d="M286 158 C318 232 346 266 372 300" stroke="#EDE7D7" strokeWidth="2" strokeDasharray="7 11" fill="none"/>

        <path d="M372 300 C496 232 700 238 820 320 C922 392 908 566 780 650 C656 732 454 698 356 578 C272 476 288 374 372 300 Z"
              stroke="#11100E" strokeWidth="42" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.84"/>
        <path className="roadline" d="M372 300 C496 232 700 238 820 320 C922 392 908 566 780 650 C656 732 454 698 356 578 C272 476 288 374 372 300 Z"
              stroke="#EDE7D7" strokeWidth="2" strokeDasharray="7 11" fill="none"/>
        <path d="M430 364 C526 312 668 314 748 366 C812 408 802 522 724 582 C632 654 480 626 414 536 C358 458 368 400 430 364 Z"
              fill="#1E1E22" opacity="0.9"/>
        <path d="M456 392 C540 354 654 356 720 398 C764 430 760 500 706 548 C634 612 512 590 456 522 C414 468 414 420 456 392 Z"
              fill="none" stroke="#7A776E" strokeWidth="1.3" strokeDasharray="5 8" opacity="0.5"/>

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

        {/* Tent area marker */}
        <g>
          <rect x="456" y="392" width="284" height="220" fill="none" stroke="#A6A49C" strokeWidth="1.4" strokeDasharray="4 6" rx="8"/>
          <text x="598" y="624" fontFamily="JetBrains Mono" fontSize="8" letterSpacing="1.5" textAnchor="middle" fill="#A6A49C">TENT AREAS T01-T10</text>
        </g>

        {/* Trees */}
        {[[48,250],[52,470],[74,610],[132,660],[318,704],[420,744],[560,748],[736,744],[932,664],[978,548],[988,430],[982,300],[930,190],[820,148],[1100,210],[1128,330],[1138,470],[1122,628]].map(([x,y]) => tree(x, y, 1))}
        {[[430,420],[520,392],[642,386],[734,424],[710,560],[600,594],[486,560],[318,464],[304,560]].map(([x,y]) => tree(x, y, 0.7))}

        {/* Pads — enlarged for easier tapping */}
        {sites.map(s => {
          const isSel = selectedSet.has(s.id);
          const label = s.siteNumber || String(s.id).replace(/\D/g, '') || s.id;
          const padW = (s.w || 88) * 1.12;
          const padH = (s.h || 38) * 1.12;
          return (
            <g key={s.id}
               className={`pad${s.taken ? ' taken' : ''}${isSel ? ' sel pulse' : ''}`}
               transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`}
               onClick={e => {
                 e.stopPropagation();
                 if (draggedRef.current || movedRef.current) return;
                 !s.taken && toggleSite(s.id);
               }}>
              <rect x={-padW/2} y={-padH/2} width={padW} height={padH} rx="5"
                    fill={s.type === 'tent' ? '#C5C3A2' : s.hookup === 'full' ? '#BFDBFE' : s.hookup === 'partial' ? '#FDE68A' : '#FECACA'}
                    stroke="#11100E" strokeWidth={isSel ? 3 : 1.6}/>
              {s.taken && (
                <rect className="taken-shade" x={-padW/2} y={-padH/2} width={padW} height={padH} rx="5" fill="url(#takenHatch)"/>
              )}
              <text x="0" y="1" fontFamily="Fraunces" fontSize="18" textAnchor="middle" fill="#11100E" dominantBaseline="middle">
                {String(label).padStart(2,'0')}
              </text>
              <text x="0" y="16" fontFamily="JetBrains Mono" fontSize="8" letterSpacing="1" textAnchor="middle" fill="#7A776E" dominantBaseline="middle">
                {s.amp}
              </text>
            </g>
          );
        })}
        </g>
      </svg>

      <div className="legend">
        <div className="l"><i className="open" /> Open</div>
        <div className="l"><i className="t" /> Taken</div>
        <div className="l"><i className="s" /> Selected</div>
        <div className="l"><i className="full" /> Full hookup (W/E/S)</div>
        <div className="l"><i className="partial" /> Water + electric</div>
        <div className="l"><i className="elec" /> Electric only</div>
      </div>
      <div className="siteplan-hint" aria-hidden="true">
        <span className="siteplan-hint-ic">⤢</span> Scroll to zoom · drag to pan
      </div>
    </div>
  );
};

// ─── Hookup booking ──────────────────────────────────────────────────────
const SquarePaymentForm = ({ session, onPay, onSuccess, onCancel }) => {
  const cardContainerId = useMemo(() => `square-card-${session.bookingCode}`, [session.bookingCode]);
  const googlePayContainerId = useMemo(() => `google-pay-${session.bookingCode}`, [session.bookingCode]);
  const [card, setCard] = useState(null);
  const [applePay, setApplePay] = useState(null);
  const [googlePay, setGooglePay] = useState(null);
  const [payments, setPayments] = useState(null);
  const [status, setStatus] = useState('Preparing secure payment form...');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checkout = session.checkout || {};
  const amountCents = checkoutAmountCents({ checkout, session });
  const amount = money(amountCents);
  const isPaymentLink = Boolean(checkout.checkoutUrl || session.checkoutUrl);
  const checkoutUrl = checkout.checkoutUrl || session.checkoutUrl || '';

  useEffect(() => {
    if (isPaymentLink) {
      setStatus('Secure Square checkout link ready.');
      return undefined;
    }
    let disposed = false;
    let mountedCard = null;
    let mountedApplePay = null;
    let mountedGooglePay = null;

    const setup = async () => {
      try {
        if (checkout.mode !== 'web-payments') throw new Error('Square Web Payments session is required.');

        const square = await loadSquareSdk(checkout.environment);
        if (!square?.payments) throw new Error('Square payment form is unavailable.');
        const paymentClient = square.payments(checkout.applicationId, checkout.locationId);
        mountedCard = await paymentClient.card();
        await mountedCard.attach(`#${cardContainerId}`);
        const paymentRequest = paymentClient.paymentRequest(
          buildSquarePaymentRequest({ checkout, amountCents }),
        );
        try {
          mountedApplePay = await paymentClient.applePay(paymentRequest);
        } catch (walletError) {
          mountedApplePay = null;
        }
        try {
          mountedGooglePay = await paymentClient.googlePay(paymentRequest);
          await mountedGooglePay.attach(`#${googlePayContainerId}`, {
            buttonColor: 'black',
            buttonType: 'pay',
          });
        } catch (walletError) {
          mountedGooglePay = null;
        }
        if (disposed) {
          mountedCard.destroy?.();
          mountedGooglePay?.destroy?.();
          return;
        }
        setPayments(paymentClient);
        setCard(mountedCard);
        setApplePay(mountedApplePay);
        setGooglePay(mountedGooglePay);
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
      mountedGooglePay?.destroy?.();
    };
  }, [checkout.mode, checkout.environment, checkout.applicationId, checkout.locationId, checkout.currency, amountCents, cardContainerId, googlePayContainerId, isPaymentLink]);

  const submitPayment = async (paymentMethod = card, methodLabel = 'card') => {
    if (busy) return;
    setError('');
    try {
      let sourceId = null;
      let verificationToken = null;
      if (!paymentMethod) throw new Error('The payment form is still loading.');
      setBusy(true);
      const result = await paymentMethod.tokenize();
      if (result.status !== 'OK') {
        const message = result.errors?.map(item => item.message).filter(Boolean).join(' ') || 'Card details could not be verified.';
        throw new Error(message);
      }
      sourceId = result.token;

      if (payments?.verifyBuyer) {
        const verification = await payments.verifyBuyer(
          sourceId,
          buildSquareVerificationDetails({ checkout, session, amountCents }),
        );
        verificationToken = verification?.token || null;
      }

      const paid = await onPay({
        bookingCode: session.bookingCode,
        sourceId,
        verificationToken,
        idempotencyKey: createPaymentIdempotencyKey(session.bookingCode, methodLabel),
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
        <button className="x" type="button" onClick={onCancel}>Close</button>
        <div className="payment-brand-row">
          <SquareMark />
          <span>Encrypted payment</span>
        </div>
        <h3>Pay <em>securely.</em></h3>
        <p>{formatSiteList(session.sites || [session.site])} {session.sites?.length > 1 ? 'are' : 'is'} held for {session.nights} nights. Payment confirms the booking.</p>
        <div className="payment-summary">
          <span>{session.bookingCode}</span>
          <strong>{amount}</strong>
        </div>
        {isPaymentLink ? (
          <>
            <button className="cta payment-submit" type="button" onClick={() => { window.location.href = checkoutUrl; }}>
              Open secure Square checkout
            </button>
            <div className="reserve-note">Square checkout may show card, Apple Pay, or Google Pay depending on your device, browser, and Square settings.</div>
          </>
        ) : (
          <>
            {applePay && (
              <button
                className="apple-pay-button"
                type="button"
                aria-label={`Pay ${amount} with Apple Pay`}
                onClick={() => submitPayment(applePay, 'Apple Pay')}
                disabled={busy}
              />
            )}
            <div
              id={googlePayContainerId}
              className={`google-pay-host${googlePay ? '' : ' hidden'}`}
              onClick={() => googlePay && submitPayment(googlePay, 'Google Pay')}
            />
            {(applePay || googlePay) && <div className="payment-divider"><span>or pay with card</span></div>}
            <div id={cardContainerId} className="square-card-host" />
            {status && <div className="reserve-note" aria-live="polite">{status}</div>}
            {error && <div className="reserve-note" aria-live="polite" style={{ color: 'var(--oxide)' }}>{error}</div>}
            <button className="cta payment-submit" type="button" onClick={() => submitPayment(card, 'Card')} disabled={busy || !card}>
              {busy ? 'Processing payment...' : `Pay ${amount}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const BookingAgreementPanel = ({
  waiverAccepted,
  quietHoursAccepted,
  setWaiverAccepted,
  setQuietHoursAccepted,
}) => {
  return (
    <div className="agreement-panel">
      <div className="agreement-topline">
        <span>Required</span>
        <strong>Before payment</strong>
      </div>
      <h3>Campground <em>agreement.</em></h3>
      <p>Read the rules and release, then check both boxes to continue. Every guest in your party is expected to follow these policies.</p>
      <div className="agreement-scroll" tabIndex="0">
        <ol>
          {RV_RULES.map(rule => <li key={rule}>{rule}</li>)}
        </ol>
        <div className="waiver-copy">
          <strong>Waiver and release</strong>
          <p>{RV_WAIVER_TEXT}</p>
        </div>
      </div>
      <div className="agreement-checks">
        <label className="booking-check">
          <input type="checkbox" checked={waiverAccepted} onChange={event => setWaiverAccepted(event.target.checked)} />
          <span>I have read and agree to the RV park rules and liability waiver.</span>
        </label>
        <label className="booking-check">
          <input type="checkbox" checked={quietHoursAccepted} onChange={event => setQuietHoursAccepted(event.target.checked)} />
          <span>I agree to quiet hours from 10:00 PM to 8:00 AM.</span>
        </label>
      </div>
    </div>
  );
};

const formatSiteList = (sites = []) => sites
  .filter(Boolean)
  .map(site => site.type === 'tent' ? site.siteNumber : `Site No. ${String(site.siteNumber || site.id || '').padStart(2,'0')}`)
  .join(', ');

const Stay = ({ sites, fuelPrices = [], phone = '', onCheckout, onPay, onDriverLicenseUpload, onReleaseHold, onDateRangeChange }) => {
  const [sel, setSel] = useState([]);
  const [arr, setArr] = useState(dateInput(1));
  const [dep, setDep] = useState(dateInput(4));
  const [rig, setRig] = useState('Class A');
  const [heads, setHeads] = useState(2);
  const [vehicles, setVehicles] = useState(1);
  const [guest, setGuest] = useState({ name: '', phone: '', email: '' });
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [quietHoursAccepted, setQuietHoursAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(true);
  const [driverLicenseFile, setDriverLicenseFile] = useState(null);
  const [licenseStatus, setLicenseStatus] = useState('');
  const [step, setStep] = useState('site');
  const [confirmed, setConfirmed] = useState(null);
  const [paymentSession, setPaymentSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nights = useMemo(() => {
    try {
      return Math.max(1, dateRangeNights(arr, dep));
    } catch {
      return 1;
    }
  }, [arr, dep]);

  const selSites = useMemo(() => {
    const ids = Array.isArray(sel) ? sel : (sel ? [sel] : []);
    const byId = new Map(sites.map(site => [site.id, site]));
    return ids.map(id => byId.get(id)).filter(Boolean);
  }, [sites, sel]);
  const selSite = selSites[selSites.length - 1] || null;
  const selectedSiteIds = selSites.map(site => site.id);
  const rateCents = selSites.reduce((sum, site) => sum + (site.nightlyPriceCents || 0), 0);
  const vehicleCount = clamp(Math.trunc(Number(vehicles) || 1), 1, 6);
  const extraVehicleFeeCents = Math.max(0, vehicleCount - 1) * 1000;
  const totalCents = (rateCents * nights) + extraVehicleFeeCents;
  const datesReady = Boolean(arr && dep && new Date(dep) > new Date(arr));
  const siteReady = Boolean(selSites.length > 0 && selSites.every(site => !site.taken) && datesReady);
  const guestFieldsReady = Boolean(guest.name.trim() && guest.phone.trim() && guest.email.trim() && driverLicenseFile);
  const agreementReady = Boolean(waiverAccepted && quietHoursAccepted);
  const ready = siteReady && guestFieldsReady && agreementReady;
  const siteKindLabel = selSite?.type === 'tent'
    ? 'walk-in tent area'
    : selSite?.type === 'pull'
      ? 'pull-through'
      : 'back-in';
  const siteCapacityLabel = selSite?.type === 'tent'
    ? 'tent area'
    : `up to ${selSite?.maxRvLengthFeet || '--'} ft`;
  const minArrivalDate = dateInput(0);
  const minDepartureDate = useMemo(() => {
    try {
      return addLocalDateDays(arr, 1);
    } catch {
      return dateInput(1);
    }
  }, [arr]);

  useEffect(() => {
    onDateRangeChange?.(arr, dep);
  }, [arr, dep]);

  useEffect(() => {
    if (selSites.length === 0) return;
    const availableSites = selSites.filter(site => !site.taken);
    if (availableSites.length !== selSites.length) {
      setSel(availableSites.map(site => site.id));
      return;
    }
    setRig(current => {
      if (selSites.every(site => site.type === 'tent')) return current === 'Tent' ? current : 'Tent';
      return current === 'Tent' ? 'Class A' : current;
    });
  }, [selSites.map(site => `${site.id}:${site.taken}:${site.type}`).join('|')]);

  const updateGuest = (field, value) => {
    setGuest(g => ({ ...g, [field]: value }));
  };
  const updateArrivalDate = (value) => {
    setArr(value);
    setDep(current => normalizeDepartureDate({
      previousStartDate: arr,
      nextStartDate: value,
      departureDate: current,
    }));
  };
  const updateDepartureDate = (value) => {
    setDep(normalizeDepartureDate({
      previousStartDate: arr,
      nextStartDate: arr,
      departureDate: value,
    }));
  };
  const onLicenseChange = (event) => {
    const file = event.target.files?.[0] || null;
    setDriverLicenseFile(file);
    setLicenseStatus(file ? `${file.name} ready to upload` : '');
  };

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const checkout = await onCheckout({
        siteId: selectedSiteIds[0],
        siteIds: selectedSiteIds,
        startDate: arr,
        endDate: dep,
        guests: heads,
        vehicles: vehicleCount,
        rig,
        customer: {
          ...guest,
          waiverAccepted,
          marketingConsent,
          reminderConsent: true,
          quietHoursAccepted,
        },
      });
      if (driverLicenseFile && onDriverLicenseUpload) {
        setLicenseStatus('Uploading driver license...');
        await onDriverLicenseUpload(checkout.bookingCode, driverLicenseFile);
        setLicenseStatus('Driver license uploaded.');
      }
      setPaymentSession({ ...checkout, site: selSite, sites: selSites, guest, arr, dep, nights, rig, heads });
    } catch (err) {
      setError(err.message || 'Checkout is unavailable right now.');
    } finally {
      setBusy(false);
    }
  };

  const cancelPaymentSession = async () => {
    const session = paymentSession;
    setPaymentSession(null);
    if (!session?.hold?.id || !onReleaseHold) return;
    try {
      await onReleaseHold(session.hold.id);
      onDateRangeChange?.(arr, dep);
    } catch (err) {
      setError(err.message || 'Could not release the booking hold. It will expire automatically.');
    }
  };

  return (
    <section className="section reveal booking-section" id="stay" style={{ background: 'var(--paper)' }}>
      <div className="head">
        <h2>Reserve your <em>site.</em></h2>
        <p>Full-hookup RV pads and walk-in tent areas right behind Midway. Pick a pad on the live map, choose your dates, and pay upfront with Square. Full hookups include water, septic, and electricity; tent areas T01–T10 sit on the center island, steps from coffee, fuel, ice, and firewood.</p>
        <a href="/manage.html" style={{ display: 'inline-block', marginTop: 20, padding: '14px 28px', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--ink)', textDecoration: 'none', border: '1px solid var(--ink)', borderRadius: 999 }}>Manage existing booking →</a>
      </div>

      <div className="book-wrap">
        <SitePlan sel={sel} setSel={setSel} sites={sites} />

        <div className="book-form">
          <div className="booking-steps" aria-label="Reservation steps">
            {[
              ['site', 'Site'],
              ['guest', 'Guest'],
              ['agreement', 'Rules'],
              ['review', 'Pay'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                data-active={step === key ? 'true' : 'false'}
                disabled={(key === 'guest' && !siteReady) || (key === 'agreement' && !guestFieldsReady) || (key === 'review' && !ready)}
                onClick={() => setStep(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {step === 'site' && (
            <>
              {selSites.length > 0 ? (
                <div className="site-detail">
                  <div className="row1">
                    <div className="num">
                      <span className="site-type-badge rv">{selSites.length === 1 ? 'Selected' : `${selSites.length} sites`}</span>
                      <em>{selSites.map(site => site.type === 'tent' ? site.siteNumber : `No. ${String(site.siteNumber).padStart(2,'0')}`).join(', ')}</em>
                    </div>
                    <div className="amp">{selSites.length === 1 ? `${selSite.type !== 'tent' ? `${selSite.amp} · ` : ''}${selSite.hookup === 'full' ? 'full hookup · ' : selSite.hookup === 'partial' ? 'water + electric · ' : ''}${siteKindLabel} · ${selSite.shade} shade · ${siteCapacityLabel}` : `${selSites.length} pads held together on one checkout`}</div>
                  </div>
                  <div className="feats">
                    {selSites.length === 1
                      ? <>{selSite.feats?.map(feat => <span key={feat}>{feat}</span>)}<span>{money(selSite.nightlyPriceCents)}/night</span></>
                      : selSites.map(site => <span key={site.id}>{site.type === 'tent' ? site.siteNumber : `Site ${site.siteNumber}`} · {money(site.nightlyPriceCents)}/night</span>)
                    }
                  </div>
                </div>
              ) : (
                <>
                  <div className="kicker">Step 1  /  Site and dates</div>
                  <h3>Pick one or more sites, <em>then dates.</em></h3>
                </>
              )}

              <div className="row2">
                <div>
                  <label>Arrive</label>
                  <input type="date" min={minArrivalDate} value={arr} onInput={e => updateArrivalDate(e.target.value)} />
                </div>
                <div>
                  <label>Depart</label>
                  <input type="date" min={minDepartureDate} value={dep} onInput={e => updateDepartureDate(e.target.value)} />
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
              <div className="contact-row">
                <label>Vehicles</label>
                <input type="number" min="1" max="6" value={vehicles} onChange={e => setVehicles(clamp(Math.trunc(+e.target.value || 1), 1, 6))} />
                <div className="reserve-note">One car is included. Extra cars are $10 each.</div>
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
                <label>Email</label>
                <input type="email" value={guest.email} onChange={e => updateGuest('email', e.target.value)} placeholder="you@example.com" />
              </div>
              <label className="booking-check">
                <input type="checkbox" checked={marketingConsent} onChange={e => setMarketingConsent(e.target.checked)} />
                <span>Keep my phone and email for reservation reminders, check-in/check-out messages, and occasional Midway updates.</span>
              </label>
              <div className="contact-row">
                <label>Driver license photo</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={onLicenseChange}
                />
                <div className="reserve-note">Uploaded privately with the reservation and used only for guest verification.</div>
              </div>
              <div className="form-actions">
                <button type="button" className="ghost-cta" onClick={() => setStep('site')}>Back</button>
                <button className="cta" type="button" onClick={() => setStep('agreement')} disabled={!guestFieldsReady}>Review campground rules →</button>
              </div>
              {licenseStatus && <div className="reserve-note">{licenseStatus}</div>}
            </>
          )}

          {step === 'agreement' && (
            <>
              <div className="kicker">Step 3  /  Rules and waiver</div>
              <BookingAgreementPanel
                waiverAccepted={waiverAccepted}
                quietHoursAccepted={quietHoursAccepted}
                setWaiverAccepted={setWaiverAccepted}
                setQuietHoursAccepted={setQuietHoursAccepted}
              />
              <div className="form-actions">
                <button type="button" className="ghost-cta" onClick={() => setStep('guest')}>Back</button>
                <button className="cta" type="button" onClick={() => setStep('review')} disabled={!agreementReady}>Continue to payment →</button>
              </div>
            </>
          )}

          {step === 'review' && (
            <>
              <div className="kicker">Step 4  /  Secure payment</div>
              <h3>Review, <em>then pay.</em></h3>
              <div className="review-card">
                <div><span>Sites</span><strong>{selSites.map(site => site.type === 'tent' ? site.siteNumber : `No. ${String(site.siteNumber).padStart(2,'0')}`).join(', ')}</strong></div>
                <div><span>Dates</span><strong>{arr} to {dep}</strong></div>
                <div><span>Setup</span><strong>{rig} · {heads} guests · {vehicleCount} vehicle{vehicleCount === 1 ? '' : 's'}</strong></div>
                <div><span>Guest</span><strong>{guest.name || 'Name required'}</strong></div>
                <div><span>Rules</span><strong>Waiver and quiet hours accepted</strong></div>
              </div>
              {selSites.map(site => (
                <div className="pick" style={{ marginTop: 12 }} key={site.id}>
                  <div><div className="det">{site.type === 'tent' ? site.siteNumber : `Site ${site.siteNumber}`}</div><div className="num">{nights} night{nights === 1 ? '' : 's'}</div></div>
                  <div style={{ textAlign:'right' }}><div className="det">Rate</div><div className="num">{money(site.nightlyPriceCents)}<span style={{fontSize:11,color:'var(--mute)',fontFamily:'var(--mono)',marginLeft:4}}>/NT</span></div></div>
                </div>
              ))}
              {extraVehicleFeeCents > 0 && (
                <div className="reserve-note">Extra vehicle fee: {money(extraVehicleFeeCents)}</div>
              )}

              <div className="total">
                <div className="l">Estimated total</div>
                <div className="amt">{money(totalCents)}<small>USD</small></div>
              </div>

              <div className="form-actions">
                <button type="button" className="ghost-cta" onClick={() => setStep('agreement')}>Back</button>
                <button className="cta" onClick={confirm} disabled={!ready || busy}>
                  {busy ? (licenseStatus.includes('Uploading') ? 'Uploading license...' : 'Preparing payment...') : `Pay and reserve ${selSites.length} site${selSites.length === 1 ? '' : 's'} →`}
                </button>
              </div>
              {error && <div className="reserve-note" style={{ color: 'var(--oxide)' }}>{error}</div>}
              <div className="reserve-note">Square payment opens next. Your booking is confirmed after payment is complete.</div>
              <div className="reserve-note" style={{ marginTop: 10, borderTop: '1px solid var(--rule)', paddingTop: 10 }}>
                <strong style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Cancellation policy</strong><br />
                Full refund 30+ days before arrival · 50% refund 14–30 days out · No refund within 14 days. <a href="/manage.html" style={{ color: 'var(--oxide)' }}>Manage booking</a>
              </div>
            </>
          )}

          {step !== 'review' && (
            <div className="reservation-mini-summary">
              <div>
                <span>Site</span>
                <strong>{selSites.length ? `${selSites.length} selected` : 'Pick one'}</strong>
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
              <div className="r"><span className="l">Sites</span><span>{formatSiteList(confirmed.sites || [confirmed.site])}</span></div>
              <div className="r"><span className="l">Arrive</span><span>{confirmed.arr}</span></div>
              <div className="r"><span className="l">Depart</span><span>{confirmed.dep}</span></div>
              <div className="r"><span className="l">Nights</span><span>{confirmed.nights} × {confirmed.sites?.length || 1} site{(confirmed.sites?.length || 1) === 1 ? '' : 's'}</span></div>
              <div className="r"><span className="l">Setup</span><span>{confirmed.rig}  ·  {confirmed.heads} guests  ·  {confirmed.hold?.quote?.vehicles || 1} vehicle{(confirmed.hold?.quote?.vehicles || 1) === 1 ? '' : 's'}</span></div>
              <div className="r" style={{ borderTop: '1px solid var(--rule)', paddingTop: 10, marginTop: 6 }}>
                <span className="l">Total</span><span style={{ fontFamily:'var(--serif)', fontSize: 22 }}>{money(confirmed.payment?.amountCents || confirmed.hold?.quote?.totalCents || 0)}</span>
              </div>
            </div>
            <div className="conf">Conf. {confirmed.bookingCode}</div>
            <a className="modal-call" href="/manage.html" style={{ display: 'block', marginTop: 8 }}>Manage or change this booking →</a>
            {phone && <a className="modal-call" href={telHref(phone)}>Call with questions →</a>}
          </div>
        </div>
      )}
      {paymentSession && (
        <SquarePaymentForm
          session={paymentSession}
          onPay={onPay}
          onCancel={cancelPaymentSession}
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
  const posts = buildInstagramPosts(settings);
  if (posts.length === 0) return null;

  const handle = settings.instagramHandle || 'midwaygrocer';
  const profileUrl = settings.instagramUrl || `https://www.instagram.com/${handle}/`;
  return (
    <section className="section reveal instagram-section" id="instagram">
      <div className="instagram-head">
        <h2>{section?.title || <>Fresh from <em>Midway.</em></>}</h2>
        <a className="instagram-handle" href={profileUrl} target="_blank" rel="noreferrer">@{handle} →</a>
      </div>
      <div className="instagram-gallery" aria-label="Midway Instagram gallery">
        {posts.map((post, index) => (
          <a className="instagram-card" key={`${post.title}-${index}`} href={post.href || profileUrl} target="_blank" rel="noreferrer">
            <img src={post.image} alt={post.caption || 'Midway Instagram post'} loading="lazy" onError={event => { event.currentTarget.src = fallbackInstagramImage(index); }} />
            {post.caption && <span className="instagram-cap">{post.caption}</span>}
          </a>
        ))}
      </div>
    </section>
  );
};

function buildInstagramPosts(settings = {}) {
  return Array.isArray(settings.instagramFeed)
    ? settings.instagramFeed.filter(post => post?.image && post?.permalink).slice(0, 6).map((post, index) => ({
        title: post.title || `Midway post ${String(index + 1).padStart(2, '0')}`,
        caption: post.caption || instagramPostCaption(post.permalink),
        image: post.image,
        href: post.permalink,
        label: post.mediaType === 'VIDEO' ? 'Reel' : 'Post',
      }))
    : [];
}

function fallbackInstagramImage(index = 0) {
  return ['/images/store-interior.jpg', '/images/store-exterior.jpg', '/images/exterior-wide.jpg', '/images/exterior-detailed.jpg'][index % 4];
}

function instagramPostCaption(postUrl = '') {
  const cleaned = String(postUrl).replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
  return cleaned ? `The latest Midway update from ${cleaned}.` : 'The latest Midway update from Instagram.';
}

const staticHookupById = Object.fromEntries(STATIC_RV_SITES.map(s => [s.id, s.hookup]));

function normalizeBootstrap(data = {}) {
  const settings = data.settings || {};
  const sections = Array.isArray(settings.sections)
    ? settings.sections
    : Array.isArray(data.sections)
      ? data.sections
      : FALLBACK_SETTINGS.sections;
  const hasHours = Array.isArray(data.hours) && data.hours.length > 0;
  return {
    ...data,
    rvSites: Array.isArray(data.rvSites)
      ? data.rvSites.map(s => ({ hookup: staticHookupById[s.id] ?? 'full', ...s }))
      : emptyBootstrap.rvSites,
    settings: {
      ...FALLBACK_SETTINGS,
      ...settings,
      instagramFeed: Array.isArray(settings.instagramFeed) ? settings.instagramFeed : [],
      sections,
    },
    hours: hasHours ? data.hours : FALLBACK_HOURS,
    featureFlags: {
      ...emptyBootstrap.featureFlags,
      ...(data.featureFlags || {}),
      instagram: data.featureFlags?.instagram !== false,
    },
  };
}

// ─── Find us ─────────────────────────────────────────────────────────────
const Find = ({ phone = '', address = '', hours = [] }) => {
  const rows = normalizedHours(hours);
  const mapSrc = address ? mapEmbedHref(address) : '';
  return (
    <section className="section" id="find" style={{ background: 'var(--paper)' }}>
      <div className="head">
        <h2>Find <em>us.</em></h2>
        <p>Midway sits at 14193 Chiwawa Loop RD in Leavenworth, just outside Plain and close to the road into Lake Wenatchee.</p>
      </div>
      <div className="find">
        <div className="map">
          <iframe title="Map to Midway Gas & Grocery" src={mapSrc} loading="eager" allowFullScreen referrerPolicy="no-referrer-when-downgrade" />
        </div>
        <div className="hours">
          {rows.length > 0 && <div className="eyebrow" style={{ marginBottom: 16 }}>Hours</div>}
          {rows.map(row => (
            <div className="h-row" key={row.day}>
              <span>{DAY_LABELS[row.day] || row.day}</span>
              <span className="t">{hourLabel(row)}</span>
            </div>
          ))}
          <div className="h-row">
            <span>Gas · pay at pump</span>
            <span className="t" style={{ color: 'var(--oxide)' }}>24/7</span>
          </div>
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
const Foot = ({ visible = {}, phone = '', address = '', instagramUrl = '' }) => (
  <footer className="foot">
    <img src="/assets/midway-logo.png" alt="Midway" className="wm" />
    <div className="foot-cols">
      <div>
        <h4>The Store</h4>
        <a href="#today">Hours &amp; status</a>
        {visible.coffee && <a href="#coffee">Coffee</a>}
        {visible.products && <a href="#order">Pantry &amp; order ahead</a>}
        {visible.rvBooking && <a href="#stay">Book Site</a>}
        {visible.rvBooking && <a href="/manage.html">Manage booking</a>}
        {visible.instagram && (
          <a href={instagramUrl || FALLBACK_SETTINGS.instagramUrl} target="_blank" rel="noreferrer">
            Instagram
          </a>
        )}
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
      setBootstrap(normalizeBootstrap(data));
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

  const uploadDriverLicense = async (bookingCode, file) => api(`/bookings/${encodeURIComponent(bookingCode)}/driver-license`, {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      dataUrl: await fileToDataUrl(file),
    }),
  });

  const payBooking = async (payload) => api('/bookings/pay', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const releaseHold = async (holdId) => api(`/bookings/holds/${encodeURIComponent(holdId)}/release`, {
    method: 'POST',
    body: JSON.stringify({
      customerSessionId: getCustomerSessionId(),
    }),
  });

  const orderCheckout = async (payload) => api('/orders/checkout', { method: 'POST', body: JSON.stringify(payload) });
  const orderPay = async (payload) => api('/orders/pay', { method: 'POST', body: JSON.stringify(payload) });

  useReveal();

  const jumpStay = () => document.getElementById('stay')?.scrollIntoView({ behavior:'smooth', block:'start' });
  const visibleSections = {
    coffee: !!(bootstrap.featureFlags?.coffee && Object.keys(bootstrap.coffeeMenu || {}).length),
    products: !!(bootstrap.featureFlags?.products && (bootstrap.products || []).length),
    rvBooking: !!bootstrap.featureFlags?.rvBooking,
    events: !!(bootstrap.featureFlags?.events && (bootstrap.events || []).length),
    instagram: !!(bootstrap.featureFlags?.instagram && buildInstagramPosts(bootstrap.settings || {}).length),
  };
  return (
    <>
      <Nav visible={visibleSections} phone={bootstrap.settings?.phone} address={bootstrap.settings?.address} />
      <Hero flags={bootstrap.featureFlags} phone={bootstrap.settings?.phone} address={bootstrap.settings?.address} hours={bootstrap.hours || []} />
      <Ticker onJumpStay={jumpStay} sites={sites} bootstrap={bootstrap} />
      <Marquee />
      {visibleSections.products && <OrderAhead products={bootstrap.products || []} onCheckout={orderCheckout} onPay={orderPay} />}
      {visibleSections.coffee && <Coffee menu={bootstrap.coffeeMenu || COFFEE} />}
      {visibleSections.rvBooking && (
        <Stay
          sites={sites}
          fuelPrices={bootstrap.fuelPrices || []}
          phone={bootstrap.settings?.phone}
          onCheckout={startCheckout}
          onDriverLicenseUpload={uploadDriverLicense}
          onPay={payBooking}
          onReleaseHold={releaseHold}
          onDateRangeChange={(startDate, endDate) => loadBootstrap({ startDate, endDate })}
        />
      )}
      {visibleSections.events && <Events events={bootstrap.events || []} />}
      {visibleSections.instagram && <Instagram settings={bootstrap.settings || {}} />}
      <Find phone={bootstrap.settings?.phone} address={bootstrap.settings?.address} hours={bootstrap.hours || []} />
      <Foot
        phone={bootstrap.settings?.phone}
        address={bootstrap.settings?.address}
        instagramUrl={bootstrap.settings?.instagramUrl}
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the driver license image.'));
    reader.readAsDataURL(file);
  });
}

createRoot(document.getElementById('root')).render(<App />);
