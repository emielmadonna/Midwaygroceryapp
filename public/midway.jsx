/* global React, ReactDOM, Square */
const { useState, useEffect, useRef, useMemo } = React;

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
  settings: {},
  fuelPrices: [],
  products: [],
  events: EVENTS,
  coffeeMenu: COFFEE,
  rvSites: [],
  rvAvailability: [],
  featureFlags: {
    fuel: false,
    products: false,
    rvBooking: false,
    events: false,
    coffee: false,
    hours: false,
    instagram: false,
  },
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
        <span className="nav-brand-name">Midway</span>
        <span className="nav-brand-sub">Gas & Grocery · Plain, WA</span>
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
        {visible.rvBooking && <a href="#stay" className="nav-cta"><span className="dot" /> Book RV Site <span className="arr">→</span></a>}
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
        <h1>Fuel, coffee, groceries, RV sites.</h1>
        <p>Midway is the Plain stop for road basics, camp supplies, bait, tackle, firewood, ice, and a place to pull in for the night.</p>
        <div className="hero-actions">
          {flags.rvBooking && <a href="#stay" className="hero-link hero-primary">Book RV Site <span>→</span></a>}
          {address && <a href={directionsHref(address)} target="_blank" rel="noreferrer" className="hero-link hero-secondary">Directions <span>↗</span></a>}
          {phone && <a href={telHref(phone)} className="hero-link hero-secondary">Call <span>{phone}</span></a>}
        </div>
      </div>
      <div className="hero-board" aria-label="Midway essentials">
        <span><b>01</b> Gas & Diesel</span>
        <span><b>02</b> Espresso</span>
        <span><b>03</b> Bait & Tackle</span>
        <span><b>14</b> RV Sites</span>
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
      {bootstrap.featureFlags?.rvBooking && <div className="open" onClick={onJumpStay}><div className="l"><i /> RV SITES</div><div className="v">{openCount}<small>/{sites.length} OPEN</small></div><div className="s">Tap to book →</div></div>}
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

// ─── Editorial / About ───────────────────────────────────────────────────
const About = () => (
  <section className="section reveal" id="about">
    <div className="head">
      <h2>The store at <em>the fork</em> in the road.</h2>
      <p>Midway is the practical stop outside Leavenworth: fuel and diesel, espresso, groceries, ice, bait, tackle, firewood, and RV sites close to Plain.</p>
    </div>
    <div className="about">
      <div className="lead">
        <span className="drop">M</span>idway should feel like the useful stop you remember: easy fuel, real coffee, road basics, and a place to stay.
      </div>
      <div className="body">
        <p>Check whether the store is open, book an RV site, call ahead, or get directions without hunting through a menu.</p>
        <p>If you need fuel, coffee, groceries, ice, bait, tackle, or a place to plug in for the night, this page should get you there without hunting.</p>
        <dl className="meta">
          <div><dt>Fuel</dt><dd>Non-ethanol & diesel</dd></div>
          <div><dt>Store</dt><dd>Espresso, groceries, ice cream</dd></div>
          <div><dt>Stay</dt><dd>RV sites</dd></div>
          <div><dt>Location</dt><dd>Plain / Leavenworth, WA</dd></div>
        </dl>
      </div>
    </div>
    <div className="about-photos">
      <div className="p wide"><Ph g="coffee" label="STORE INTERIOR  /  MORNING LIGHT" /></div>
      <div className="p"><Ph g="jar" label="GROCERIES  /  CAMP BASICS" /></div>
      <div className="p"><Ph g="pump" label="PUMP 3, FACING WEST" /></div>
    </div>
  </section>
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
const SitePlan = ({ sel, setSel, sites }) => {
  const [touring, setTouring] = useState(false);
  const stageRef = useRef(null);

  // Zoom-to-site: compute transform that centers the selected pad in the viewport.
  const zoom = useMemo(() => {
    const s = sites.find(x => x.id === sel);
    if (!s) return { tx: 0, ty: 0, sc: 1 };
    const sc = 1.55;
    const cx = 600, cy = 400; // viewBox center
    const tx = clamp(cx - s.x * sc, 1200 - 1200 * sc, 0);
    const ty = clamp(cy - s.y * sc, 800 - 800 * sc, 0);
    return { tx, ty, sc };
  }, [sel]);

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
      <svg ref={stageRef} className="stage" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"
           style={{ transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.sc})`, transformOrigin: '0 0' }}>
        <defs>
          <pattern id="forest" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M30 8 L22 28 L26 28 L18 42 L26 42 L22 52 L38 52 L34 42 L42 42 L34 28 L38 28 Z" fill="#4A4936" opacity=".22"/>
          </pattern>
          <pattern id="water" x="0" y="0" width="40" height="14" patternUnits="userSpaceOnUse">
            <path d="M0 7 Q10 0 20 7 T40 7" stroke="#8AA39A" strokeWidth="1.2" fill="none" opacity=".7"/>
          </pattern>
        </defs>

        <rect width="1200" height="800" fill="#D9D2B4"/>
        <rect width="1200" height="800" fill="url(#forest)" opacity="0.35"/>

        {/* Highway, drive, and loop traced from the supplied satellite reference */}
        <path d="M-80 150 L560 -42" stroke="#2A2925" strokeWidth="56" fill="none" strokeLinecap="round" opacity="0.9"/>
        <path d="M-80 150 L560 -42" stroke="#EDE7D7" strokeWidth="2" strokeDasharray="18 18" fill="none" opacity="0.8"/>
        <text x="84" y="106" fontFamily="JetBrains Mono" fontSize="11" letterSpacing="2" fill="#11100E" transform="rotate(-17 84 106)">HWY 22</text>

        <path d="M288 158 C320 232 354 268 404 314" stroke="#11100E" strokeWidth="32" fill="none" strokeLinecap="round" opacity="0.82"/>
        <path d="M288 158 C320 232 354 268 404 314" stroke="#EDE7D7" strokeWidth="2" strokeDasharray="7 11" fill="none"/>

        <path d="M404 314 C496 246 660 232 792 260 C888 280 922 382 890 522 C862 644 754 716 610 704 C468 692 336 640 292 548 C246 450 302 366 404 314 Z"
              stroke="#11100E" strokeWidth="42" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.84"/>
        <path className="roadline" d="M404 314 C496 246 660 232 792 260 C888 280 922 382 890 522 C862 644 754 716 610 704 C468 692 336 640 292 548 C246 450 302 366 404 314 Z"
              stroke="#EDE7D7" strokeWidth="2" strokeDasharray="7 11" fill="none"/>
        <path d="M426 366 C510 312 652 302 758 330 C830 350 846 430 816 536 C788 618 712 658 610 658 C488 658 392 616 356 542 C322 470 348 414 426 366 Z"
              fill="#C5C3A2" opacity="0.78"/>
        <path d="M440 386 C520 344 640 338 734 360 C792 374 806 438 782 514 C756 584 694 622 612 626 C506 628 426 594 392 532 C362 474 378 426 440 386 Z"
              fill="none" stroke="#7A776E" strokeWidth="1.3" strokeDasharray="5 8" opacity="0.5"/>
        {touring && selSite && (
          <g className="rover" transform={`translate(${selSite.x} ${selSite.y})`}>
            <circle r="14" fill="#B0341E" opacity="0.25"/>
            <circle r="7" fill="#B0341E"/>
            <circle r="3" fill="#F5F0E1"/>
          </g>
        )}

        {/* Store, yard buildings, and service edges */}
        <g>
          <rect x="118" y="206" width="130" height="84" fill="#EDE7D7" stroke="#11100E" strokeWidth="2" rx="2"/>
          <path d="M118 206 L183 176 L248 206 Z" fill="#B0341E" stroke="#11100E" strokeWidth="2"/>
          <text x="183" y="256" fontFamily="Fraunces" fontSize="14" textAnchor="middle" fill="#11100E" fontStyle="italic">store</text>
          <text x="183" y="306" fontFamily="JetBrains Mono" fontSize="8.5" letterSpacing="1.6" textAnchor="middle" fill="#11100E">MIDWAY</text>
        </g>
        <g>
          <rect x="260" y="118" width="150" height="56" fill="#EDE7D7" stroke="#11100E" strokeWidth="2" rx="2"/>
          <rect x="474" y="84" width="160" height="70" fill="#D7B895" stroke="#11100E" strokeWidth="2" rx="2"/>
          <rect x="652" y="124" width="94" height="52" fill="#B0341E" opacity="0.72" stroke="#11100E" strokeWidth="2" rx="2"/>
          <text x="554" y="174" fontFamily="JetBrains Mono" fontSize="8.5" letterSpacing="1.6" textAnchor="middle" fill="#11100E">SHOP / YARD</text>
        </g>
        <g>
          <rect x="104" y="316" width="186" height="56" fill="#2A2925" stroke="#11100E" strokeWidth="2" rx="2"/>
          {[0,1,2,3].map(i => (
            <rect key={i} x={126 + i*42} y={330} width="22" height="28" fill="#EDE7D7" stroke="#11100E"/>
          ))}
          <text x="197" y="392" fontFamily="JetBrains Mono" fontSize="8.5" letterSpacing="1.7" textAnchor="middle" fill="#11100E">PUMPS</text>
        </g>

        {/* Common markers */}
        <g>
          <rect x="512" y="474" width="190" height="92" fill="none" stroke="#11100E" strokeWidth="1.4" strokeDasharray="4 6" rx="5"/>
          <text x="607" y="524" fontFamily="JetBrains Mono" fontSize="8" letterSpacing="1.5" textAnchor="middle" fill="#11100E">CENTER ISLAND</text>
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

        <text x="1130" y="780" fontFamily="JetBrains Mono" fontSize="9" letterSpacing="2" textAnchor="end" fill="#11100E">RV SITES 03-16</text>
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
  const ready = !!selSite && guest.name.trim() && guest.phone.trim();

  useEffect(() => {
    onDateRangeChange?.(arr, dep);
  }, [arr, dep]);

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
    <section className="section reveal" id="stay" style={{ background: 'var(--paper)' }}>
      <div className="head">
        <h2>Book an RV site. <em>Stay awhile.</em></h2>
        <p>Pick an open site, add your dates and contact info, and Midway will hold the spot while the secure Square payment form opens. Payment confirms the booking.</p>
      </div>

      <div className="book-wrap">
        <SitePlan sel={sel} setSel={setSel} sites={sites} />

        <div className="book-form">
          {selSite ? (
            <div className="site-detail">
              <div className="row1">
                <div className="num">Site <em>No. {String(selSite.siteNumber || selSite.id).padStart(2,'0')}</em></div>
                <div className="amp">{selSite.amp} · {selSite.type === 'pull' ? 'pull-through' : 'back-in'} · {selSite.shade} shade · up to {selSite.maxRvLengthFeet || '--'} ft</div>
              </div>
              <div className="feats">
                {selSite.feats.map(f => <span key={f}>{f}</span>)}
                {selSite.sku && <span>{selSite.sku}</span>}
              </div>
            </div>
          ) : (
            <>
              <div className="kicker">Reservation  /  Lot Plan</div>
              <h3>Pick a site, <em>choose your dates.</em></h3>
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
              <label>Rig</label>
              <select value={rig} onChange={e => setRig(e.target.value)}>
                <option>Van / Truck</option><option>Travel Trailer</option>
                <option>Class C</option><option>Class A</option><option>Fifth Wheel</option>
              </select>
            </div>
            <div>
              <label>Travelers</label>
              <input type="number" min="1" max="8" value={heads} onChange={e => setHeads(+e.target.value)} />
            </div>
          </div>

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

          <div className="pick" style={{ marginTop: 20 }}>
            <div><div className="det">Nights</div><div className="num">{nights}</div></div>
            <div style={{ textAlign:'right' }}><div className="det">Rate</div><div className="num">{money(rateCents)}<span style={{fontSize:11,color:'var(--mute)',fontFamily:'var(--mono)',marginLeft:4}}>/NT</span></div></div>
          </div>

          <div className="total">
            <div className="l">Estimated total</div>
            <div className="amt">{money(totalCents)}<small>USD</small></div>
          </div>

          <button className="cta" onClick={confirm} disabled={!ready || busy}>
            {busy ? 'Preparing payment...' : sel ? `Reserve site no. ${String(selSite?.siteNumber || sel).padStart(2,'0')} →` : 'Pick a site to continue'}
          </button>
          {error && <div className="reserve-note" style={{ color: 'var(--oxide)' }}>{error}</div>}
          <div className="reserve-note">Square payment opens on this page. Your booking is confirmed after payment is complete.</div>
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
              <div className="r"><span className="l">Rig</span><span>{confirmed.rig}  ·  {confirmed.heads} guests</span></div>
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
  const handle = String(settings.instagramHandle || '').replace(/^@/, '').trim();
  const url = settings.instagramUrl || (handle ? `https://www.instagram.com/${handle}/` : '');
  const posts = Array.isArray(settings.instagramPosts) ? settings.instagramPosts.filter(Boolean).slice(0, 4) : [];
  if (!url && posts.length === 0) return null;

  return (
    <section className="section reveal instagram-section" id="instagram">
      <div className="head">
        <h2>Fresh from <em>the feed.</em></h2>
        <p>Follow along for store updates, seasonal road conditions, fresh arrivals, and RV site notes from Plain.</p>
      </div>
      <div className="instagram-wrap">
        <div className="instagram-copy">
          <div className="eyebrow">Instagram</div>
          <h3>{handle ? `@${handle}` : 'Midway on Instagram'}</h3>
          <p>Embedded Instagram content can be blocked by privacy settings, so the direct profile link stays available.</p>
          {url && <a className="instagram-link" href={url} target="_blank" rel="noreferrer">Open Instagram ↗</a>}
        </div>
        <div className="instagram-embed">
          {posts.length > 0 ? (
            <div className="instagram-post-grid">
              {posts.map((postUrl, index) => (
                <iframe
                  key={postUrl}
                  title={`Midway Instagram post ${index + 1}`}
                  src={`${postUrl.replace(/\/$/, '')}/embed/captioned`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ))}
            </div>
          ) : (
            <iframe
              title="Midway Instagram profile"
              src={`${url.replace(/\/$/, '')}/embed`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          )}
          <div className="instagram-fallback">
            <span>Instagram embed unavailable</span>
            {url && <a href={url} target="_blank" rel="noreferrer">View profile</a>}
          </div>
        </div>
      </div>
    </section>
  );
};

// ─── Find us ─────────────────────────────────────────────────────────────
const Find = ({ phone = '', address = '', hours = [] }) => {
  const rows = normalizedHours(hours);
  return (
    <section className="section reveal" id="find" style={{ background: 'var(--paper)' }}>
      <div className="head">
        <h2>Find <em>us.</em></h2>
        <p>On US-2 near Plain and Leavenworth, close enough to be useful and tucked far enough into the mountains to feel like a proper stop.</p>
      </div>
      <div className="find">
        <div className="map">
        <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="tree" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M40 18 L28 44 L34 44 L24 64 L34 64 L28 78 L52 78 L46 64 L56 64 L46 44 L52 44 Z" fill="#4A4936" opacity=".18"/>
            </pattern>
          </defs>
          <rect width="800" height="600" fill="#F5F0E1"/>
          <rect width="800" height="600" fill="url(#tree)"/>
          <path d="M0 480 Q200 430 360 410 T800 320" stroke="#11100E" strokeWidth="3" fill="none" strokeDasharray="0"/>
          <path d="M360 410 Q420 380 500 280 T720 80" stroke="#B0341E" strokeWidth="3" fill="none" strokeDasharray="6 6"/>
          <text x="40" y="500" fontFamily="JetBrains Mono" fontSize="11" letterSpacing="2" fill="#7A776E">US-2 →</text>
          <text x="540" y="180" fontFamily="JetBrains Mono" fontSize="11" letterSpacing="2" fill="#7A776E">PLAIN / LEAVENWORTH</text>
          <circle cx="500" cy="280" r="14" fill="#B0341E"/>
          <circle cx="500" cy="280" r="26" fill="none" stroke="#B0341E" strokeWidth="1.5" opacity=".4">
            <animate attributeName="r" values="14;42;14" dur="3s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values=".5;0;.5" dur="3s" repeatCount="indefinite"/>
          </circle>
          <text x="520" y="262" fontFamily="Fraunces" fontStyle="italic" fontSize="22" fill="#11100E">Midway</text>
          {address && <text x="520" y="282" fontFamily="JetBrains Mono" fontSize="10" letterSpacing="2" fill="#7A776E">{address}</text>}
        </svg>
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
        {visible.rvBooking && <a href="#stay">Book RV Site</a>}
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
        <p>Fuel, coffee, bait, tackle, ice, firewood, snacks, drinks, and RV sites in Plain, Washington.</p>
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
      <About />
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

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
