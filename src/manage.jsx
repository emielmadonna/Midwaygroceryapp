/* global Square */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  addLocalDateDays,
  buildSquarePaymentRequest,
  buildSquareVerificationDetails,
  createPaymentIdempotencyKey,
  dateRangeNights,
} from './lib/public-checkout.js';

const API_ROOT = ['3000', '3002', '5173'].includes(window.location.port)
  ? 'http://127.0.0.1:3001/api'
  : '/api';

const EXTRA_VEHICLE_CENTS = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function api(path, opts = {}) {
  const res = await fetch(`${API_ROOT}${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data: payload.data, error: payload.error };
}

function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function dateInput(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+d}, ${y}`;
}

function statusLabel(status) {
  const map = { confirmed: 'Confirmed', paid: 'Paid', hold: 'Held', canceled: 'Canceled', refunded: 'Refunded', expired: 'Expired', blocked: 'Blocked' };
  return map[status] || status;
}

function policyText(daysOut) {
  if (daysOut >= 30) return 'Full refund eligible (30+ days out)';
  if (daysOut >= 14) return '50% refund eligible (14–30 days out)';
  return 'No refund (within 14 days of arrival)';
}

function previewDiff(booking, patch) {
  const siteLines = booking.siteLines || [];
  const nights = patch.startDate && patch.endDate ? dateRangeNights(patch.startDate, patch.endDate) : booking.nights;
  const vehicles = patch.vehicles ?? booking.vehicles ?? 1;
  const nightlyTotal = siteLines.length
    ? siteLines.reduce((sum, l) => sum + (l.nightlyPriceCents || 0), 0)
    : Math.round((booking.subtotalCents || 0) / (booking.nights || 1));
  const newSubtotal = nightlyTotal * nights;
  const newFee = Math.max(0, vehicles - 1) * EXTRA_VEHICLE_CENTS;
  const newTotal = newSubtotal + newFee;
  return { newTotal, diff: newTotal - (booking.totalCents || 0), nights, vehicles, newSubtotal, newFee };
}

let squareSdkPromise;
function loadSquareSdk(env = 'sandbox') {
  const src = env === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js';
  if (window.Square) return Promise.resolve(window.Square);
  if (!squareSdkPromise) {
    squareSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => window.Square ? resolve(window.Square) : reject(new Error('Square payment form unavailable.'));
      script.onerror = () => reject(new Error('Square payment form failed to load.'));
      document.head.appendChild(script);
    });
  }
  return squareSdkPromise;
}

// ─── Square supplement payment form ──────────────────────────────────────────

const SupplementPayForm = ({ bookingCode, diffCents, checkoutConfig, onPaid, onCancel }) => {
  const cardRef = useRef(null);
  const [card, setCard] = useState(null);
  const [status, setStatus] = useState('Loading secure payment form…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const containerId = `sq-card-${bookingCode}`;

  useEffect(() => {
    let mounted = true;
    let mountedCard = null;
    (async () => {
      try {
        if (!checkoutConfig?.mode || checkoutConfig.mode !== 'web-payments') {
          setStatus(''); setError('Payment session unavailable.'); return;
        }
        const square = await loadSquareSdk(checkoutConfig.environment);
        if (!square?.payments) throw new Error('Square SDK unavailable.');
        const payments = square.payments(checkoutConfig.applicationId, checkoutConfig.locationId);
        mountedCard = await payments.card();
        await mountedCard.attach(`#${containerId}`);
        if (mounted) { setCard(mountedCard); setStatus(''); }
      } catch (err) {
        if (mounted) setError(err.message || 'Payment form unavailable.');
      }
    })();
    return () => { mounted = false; mountedCard?.destroy?.(); };
  }, []);

  const pay = async () => {
    setError(''); setBusy(true);
    try {
      if (!card) throw new Error('Payment form is still loading.');
      const result = await card.tokenize();
      if (result.status !== 'OK') throw new Error(result.errors?.[0]?.message || 'Card declined.');
      onPaid({ sourceId: result.token, idempotencyKey: createPaymentIdempotencyKey(bookingCode, 'card') });
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal payment-modal" onClick={e => e.stopPropagation()}>
        <button className="x" type="button" onClick={onCancel}>Close</button>
        <div className="payment-brand-row">
          <span className="square-mark" aria-label="Square checkout">
            <span className="square-mark__icon" aria-hidden="true" />
            <span>Square checkout</span>
          </span>
          <span>Encrypted payment</span>
        </div>
        <h3>Pay <em>the difference.</em></h3>
        <p>Your booking change adds <strong>{money(diffCents)}</strong>. Enter your card to confirm.</p>
        <div className="payment-summary">
          <span>{bookingCode}</span>
          <strong style={{ fontFamily: 'var(--serif)', fontSize: 22 }}>{money(diffCents)}</strong>
        </div>
        <div id={containerId} className="square-card-host" />
        {status && <div className="reserve-note" aria-live="polite">{status}</div>}
        {error && <div className="reserve-note" aria-live="polite" style={{ color: 'var(--oxide)' }}>{error}</div>}
        <button className="payment-submit" type="button" onClick={pay} disabled={busy || !card}>
          {busy ? 'Processing…' : `Pay ${money(diffCents)}`}
        </button>
      </div>
    </div>
  );
};

// ─── Nav ─────────────────────────────────────────────────────────────────────

const Nav = () => (
  <nav className="nav">
    <a href="/" className="nav-brand" aria-label="Midway Gas &amp; Grocery">
      <img src="/assets/midway-logo.png" alt="Midway" className="nav-logo" />
      <span className="nav-brand-sub">Plain, Washington</span>
    </a>
    <div className="nav-links" />
    <div className="nav-actions">
      <a href="/#stay" className="nav-action">Book a site</a>
    </div>
  </nav>
);

// ─── Lookup screen ────────────────────────────────────────────────────────────

const Lookup = ({ onFound }) => {
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async e => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = await api('/bookings/lookup', { method: 'POST', body: { phone, email } });
      if (!res.ok) throw new Error(res.error?.message || 'Lookup failed.');
      onFound(res.data || [], phone, email);
    } catch (err) {
      setError(err.message || 'Could not find bookings. Check your phone and email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="head">
        <h2>Manage your <em>booking.</em></h2>
        <p>Enter the phone and email you used when you booked to look up your reservation.</p>
      </div>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <form className="book-form" onSubmit={submit} style={{ position: 'static' }}>
          <div className="kicker">Find your booking</div>
          <label>Phone number</label>
          <input type="tel" placeholder="(555) 000-0000" value={phone} onChange={e => setPhone(e.target.value)} required autoComplete="tel" />
          <label>Email address</label>
          <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
          {error && <div className="reserve-note" style={{ color: 'var(--oxide)', marginTop: 14 }}>{error}</div>}
          <button className="cta" type="submit" disabled={busy || !phone || !email}>
            {busy ? 'Searching…' : 'Find my booking →'}
          </button>
          <div className="reserve-note">We use your phone and email to verify your identity before making any changes.</div>
        </form>
      </div>
    </section>
  );
};

// ─── Booking list ─────────────────────────────────────────────────────────────

const BookingList = ({ bookings, phone, email, onSelect, onNewLookup }) => {
  if (!bookings.length) {
    return (
      <section className="section">
        <div className="head">
          <h2>No bookings <em>found.</em></h2>
          <p>No upcoming reservations matched that phone and email. Double-check your details or call us if you need help.</p>
        </div>
        <div style={{ maxWidth: 320, margin: '0 auto' }}>
          <button
            type="button"
            onClick={onNewLookup}
            style={{ width: '100%', marginTop: 0, padding: '18px', background: 'var(--ink)', color: 'var(--paper)', borderRadius: 999, border: 'none', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', cursor: 'pointer' }}
          >
            Try again →
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="head">
        <h2>Your <em>bookings.</em></h2>
        <p>Select a reservation to edit dates, adjust vehicles, or cancel.</p>
      </div>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'grid', gap: 16 }}>
        {bookings.map(b => (
          <button
            key={b.bookingCode}
            type="button"
            onClick={() => onSelect(b)}
            style={{ background: 'var(--paper)', border: '1px solid var(--ink)', padding: '22px 24px', textAlign: 'left', cursor: 'pointer', borderRadius: 0, width: '100%', transition: 'background .2s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bone-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--paper)'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 24 }}>{b.bookingCode}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '4px 10px', border: '1px solid var(--rule-2)', borderRadius: 999, color: b.status === 'confirmed' ? 'var(--olive)' : 'var(--mute)' }}>
                {statusLabel(b.status)}
              </span>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--mute)', lineHeight: 1.8 }}>
              <div>Site {(b.rvSiteIds || [b.rvSiteId]).join(', ')}  ·  {formatDate(b.startDate)} → {formatDate(b.endDate)}</div>
              <div>{b.nights} night{b.nights !== 1 ? 's' : ''}  ·  {b.vehicles || 1} vehicle{(b.vehicles || 1) !== 1 ? 's' : ''}  ·  {money(b.totalCents)}</div>
            </div>
          </button>
        ))}
        <button type="button" onClick={onNewLookup} style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--mute)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'center', marginTop: 8 }}>
          ← Different phone or email
        </button>
      </div>
    </section>
  );
};

// ─── Booking detail ───────────────────────────────────────────────────────────

const BookingDetail = ({ booking, phone, email, onEdit, onCancel, onBack }) => {
  const editable = ['confirmed', 'paid'].includes(booking.status);
  const cancelable = !['canceled', 'expired', 'refunded'].includes(booking.status);
  const now = new Date();
  const start = new Date(`${booking.startDate}T00:00:00Z`);
  const daysOut = Math.floor((start - now) / 86400000);

  return (
    <section className="section">
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <button type="button" onClick={onBack} style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--mute)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 28 }}>
          ← All bookings
        </button>
        <div className="book-form" style={{ position: 'static' }}>
          <div className="kicker">Reservation</div>
          <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 38, lineHeight: 1, marginBottom: 4 }}>
            {booking.bookingCode}
          </h3>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '4px 10px', border: '1px solid var(--rule-2)', borderRadius: 999, display: 'inline-block', color: booking.status === 'confirmed' ? 'var(--olive)' : 'var(--mute)', marginBottom: 20 }}>
            {statusLabel(booking.status)}
          </div>

          <div className="modal" style={{ position: 'static', maxWidth: '100%', padding: '16px 18px', margin: '0 0 20px', boxShadow: 'none', borderRadius: 12 }}>
            <div className="receipt" style={{ margin: 0 }}>
              <div className="r"><span className="l">Sites</span><span>{(booking.rvSiteIds || [booking.rvSiteId]).join(', ')}</span></div>
              <div className="r"><span className="l">Arrive</span><span>{formatDate(booking.startDate)}</span></div>
              <div className="r"><span className="l">Depart</span><span>{formatDate(booking.endDate)}</span></div>
              <div className="r"><span className="l">Nights</span><span>{booking.nights}</span></div>
              <div className="r"><span className="l">Vehicles</span><span>{booking.vehicles || 1}</span></div>
              <div className="r"><span className="l">Guests</span><span>{booking.guests || 1}</span></div>
              <div className="r" style={{ borderTop: '1px solid var(--rule)', paddingTop: 8, marginTop: 4 }}>
                <span className="l">Total</span>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{money(booking.totalCents)}</span>
              </div>
            </div>
          </div>

          {editable && (
            <div className="reserve-note" style={{ marginBottom: 16 }}>
              <strong style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Cancellation policy</strong><br />
              {policyText(daysOut)}
            </div>
          )}

          {editable && (
            <button className="cta" type="button" onClick={onEdit} style={{ marginBottom: 10 }}>
              Edit booking →
            </button>
          )}
          {cancelable && (
            <button
              type="button"
              onClick={onCancel}
              style={{ width: '100%', marginTop: 8, padding: '14px', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--rule-2)', borderRadius: 999, cursor: 'pointer', color: 'var(--mute)', transition: 'border-color .2s, color .2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--oxide)'; e.currentTarget.style.color = 'var(--oxide)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--rule-2)'; e.currentTarget.style.color = 'var(--mute)'; }}
            >
              Cancel booking
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

// ─── Edit form ────────────────────────────────────────────────────────────────

const EditForm = ({ booking, phone, email, onDone, onBack }) => {
  const [startDate, setStartDate] = useState(booking.startDate);
  const [endDate, setEndDate] = useState(booking.endDate);
  const [vehicles, setVehicles] = useState(booking.vehicles || 1);
  const [guests, setGuests] = useState(booking.guests || 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paySession, setPaySession] = useState(null);

  const preview = useMemo(() => previewDiff(booking, { startDate, endDate, vehicles, guests }), [startDate, endDate, vehicles, guests]);
  const hasChanges = startDate !== booking.startDate || endDate !== booking.endDate || vehicles !== (booking.vehicles || 1) || guests !== (booking.guests || 1);
  const minDep = useMemo(() => { try { return addLocalDateDays(startDate, 1); } catch { return ''; } }, [startDate]);
  const today = dateInput(0);
  const diffLabel = preview.diff === 0 ? 'No charge' : preview.diff > 0 ? `+${money(preview.diff)} due` : `${money(Math.abs(preview.diff))} refund`;
  const diffColor = preview.diff > 0 ? 'var(--oxide)' : preview.diff < 0 ? 'var(--olive)' : 'var(--mute)';

  const submitEdit = async (sourceId = null, idempotencyKey = null) => {
    setBusy(true); setError('');
    try {
      const body = { phone, email, startDate, endDate, vehicles, guests };
      if (sourceId) { body.sourceId = sourceId; body.idempotencyKey = idempotencyKey; }
      const res = await api(`/bookings/${booking.bookingCode}/edit`, { method: 'POST', body });
      if (res.status === 402) {
        setPaySession({ diffCents: res.data.diffCents, checkoutConfig: res.data.checkoutConfig });
        setBusy(false); return;
      }
      if (!res.ok) throw new Error(res.error?.message || 'Edit failed.');
      onDone(res.data.booking);
    } catch (err) {
      setError(err.message || 'Could not save changes. Please try again.');
      setBusy(false);
    }
  };

  return (
    <>
      <section className="section">
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <button type="button" onClick={onBack} style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--mute)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 28 }}>
            ← Back
          </button>
          <div className="book-form" style={{ position: 'static' }}>
            <div className="kicker">Edit · {booking.bookingCode}</div>
            <h3>Change your <em>stay.</em></h3>

            <div className="row2">
              <div>
                <label>Arrive</label>
                <input type="date" min={today} value={startDate} onChange={e => setStartDate(e.target.value)} disabled={!!paySession} />
              </div>
              <div>
                <label>Depart</label>
                <input type="date" min={minDep} value={endDate} onChange={e => setEndDate(e.target.value)} disabled={!!paySession} />
              </div>
            </div>

            <div className="row2">
              <div>
                <label>Vehicles</label>
                <input type="number" min="1" max="6" value={vehicles} onChange={e => setVehicles(Math.max(1, Math.min(6, +e.target.value || 1)))} disabled={!!paySession} />
              </div>
              <div>
                <label>Guests</label>
                <input type="number" min="1" max="12" value={guests} onChange={e => setGuests(Math.max(1, +e.target.value || 1))} disabled={!!paySession} />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--rule)', marginTop: 24, paddingTop: 18 }}>
              <div className="book-form" style={{ position: 'static', background: 'none', border: 'none', padding: 0 }}>
                <div className="pick">
                  <span className="det">Nights</span>
                  <span className="num">{preview.nights}</span>
                </div>
                <div className="pick">
                  <span className="det">Site subtotal</span>
                  <span className="num">{money(preview.newSubtotal)}</span>
                </div>
                {preview.newFee > 0 && (
                  <div className="pick">
                    <span className="det">Extra vehicles</span>
                    <span className="num">{money(preview.newFee)}</span>
                  </div>
                )}
                <div className="total">
                  <span className="l">New total</span>
                  <span className="amt">{money(preview.newTotal)}<small>USD</small></span>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: diffColor, marginTop: 8 }}>
                  {diffLabel}
                </div>
              </div>
            </div>

            {error && <div className="reserve-note" style={{ color: 'var(--oxide)', marginTop: 12 }}>{error}</div>}
            <button className="cta" type="button" disabled={busy || !hasChanges} onClick={() => submitEdit()}>
              {busy ? 'Saving…' : preview.diff > 0 ? `Pay ${money(preview.diff)} and save →` : 'Save changes →'}
            </button>
            {preview.diff < 0 && <div className="reserve-note">A refund of {money(Math.abs(preview.diff))} will be issued to your original payment method.</div>}
          </div>
        </div>
      </section>

      {paySession && (
        <SupplementPayForm
          bookingCode={booking.bookingCode}
          diffCents={paySession.diffCents}
          checkoutConfig={paySession.checkoutConfig}
          onCancel={() => { setPaySession(null); setBusy(false); }}
          onPaid={({ sourceId, idempotencyKey }) => { setPaySession(null); submitEdit(sourceId, idempotencyKey); }}
        />
      )}
    </>
  );
};

// ─── Cancel confirm ───────────────────────────────────────────────────────────

const CancelConfirm = ({ booking, phone, email, onDone, onBack }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = new Date();
  const start = new Date(`${booking.startDate}T00:00:00Z`);
  const daysOut = Math.floor((start - now) / 86400000);
  const refundCents = daysOut >= 30 ? booking.totalCents : daysOut >= 14 ? Math.floor(booking.totalCents / 2) : 0;
  const tier = daysOut >= 30 ? 'full' : daysOut >= 14 ? 'half' : 'none';

  const confirm = async () => {
    setBusy(true); setError('');
    try {
      const res = await api(`/bookings/${booking.bookingCode}/cancel`, { method: 'POST', body: { phone, email } });
      if (!res.ok) throw new Error(res.error?.message || 'Cancellation failed.');
      onDone(res.data);
    } catch (err) {
      setError(err.message || 'Could not cancel. Please call us for help.');
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <button type="button" onClick={onBack} style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--mute)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 28 }}>
          ← Back
        </button>
        <div className="book-form" style={{ position: 'static' }}>
          <div className="kicker">Cancel · {booking.bookingCode}</div>
          <h3>Are you <em>sure?</em></h3>
          <p style={{ marginBottom: 0 }}>This will cancel your reservation for {formatDate(booking.startDate)}–{formatDate(booking.endDate)}.</p>

          <div className="modal" style={{ position: 'static', maxWidth: '100%', padding: '16px 18px', margin: '20px 0', boxShadow: 'none', borderRadius: 12 }}>
            <div className="receipt" style={{ margin: 0 }}>
              <div className="r"><span className="l">Policy</span><span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{policyText(daysOut)}</span></div>
              <div className="r"><span className="l">Paid</span><span>{money(booking.totalCents)}</span></div>
              <div className="r" style={{ borderTop: '1px solid var(--rule)', paddingTop: 8, marginTop: 4 }}>
                <span className="l">Refund</span>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 20, color: tier !== 'none' ? 'var(--olive)' : 'var(--mute)' }}>
                  {tier === 'none' ? 'None' : money(refundCents)}
                </span>
              </div>
            </div>
          </div>

          {tier === 'none' && <div className="reserve-note" style={{ marginBottom: 16, color: 'var(--oxide)' }}>Your arrival is within 14 days. Per our policy, no refund will be issued.</div>}
          {tier === 'half' && <div className="reserve-note" style={{ marginBottom: 16 }}>Your arrival is 14–30 days out. A 50% refund of {money(refundCents)} will be returned to your original payment method.</div>}
          {tier === 'full' && <div className="reserve-note" style={{ marginBottom: 16 }}>Your arrival is 30+ days out. A full refund of {money(refundCents)} will be returned to your original payment method.</div>}

          {error && <div className="reserve-note" style={{ color: 'var(--oxide)', marginBottom: 12 }}>{error}</div>}
          <button
            className="cta"
            type="button"
            disabled={busy}
            onClick={confirm}
            style={{ background: 'var(--oxide)' }}
          >
            {busy ? 'Canceling…' : 'Yes, cancel my booking'}
          </button>
          <button type="button" onClick={onBack} style={{ width: '100%', marginTop: 10, padding: '14px', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--rule-2)', borderRadius: 999, cursor: 'pointer', color: 'var(--mute)' }}>
            Keep my booking
          </button>
        </div>
      </div>
    </section>
  );
};

// ─── Done screens ─────────────────────────────────────────────────────────────

const EditDone = ({ booking }) => (
  <section className="section">
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div className="book-form" style={{ position: 'static' }}>
        <div className="kicker">Updated</div>
        <h3>Booking <em>updated.</em></h3>
        <p>Your changes have been saved. See you at Midway.</p>
        <div className="modal" style={{ position: 'static', maxWidth: '100%', padding: '16px 18px', margin: '20px 0', boxShadow: 'none', borderRadius: 12 }}>
          <div className="receipt" style={{ margin: 0 }}>
            <div className="r"><span className="l">Code</span><span>{booking.bookingCode}</span></div>
            <div className="r"><span className="l">Arrive</span><span>{formatDate(booking.startDate)}</span></div>
            <div className="r"><span className="l">Depart</span><span>{formatDate(booking.endDate)}</span></div>
            <div className="r"><span className="l">Nights</span><span>{booking.nights}</span></div>
            <div className="r" style={{ borderTop: '1px solid var(--rule)', paddingTop: 8, marginTop: 4 }}>
              <span className="l">New total</span>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{money(booking.totalCents)}</span>
            </div>
          </div>
        </div>
        <div className="conf">Conf. {booking.bookingCode}</div>
        <a href="/" className="modal-call">← Back to Midway</a>
      </div>
    </div>
  </section>
);

const CancelDone = ({ result }) => (
  <section className="section">
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div className="book-form" style={{ position: 'static' }}>
        <div className="kicker">Canceled</div>
        <h3>Booking <em>canceled.</em></h3>
        <p>
          {result?.refundCents > 0
            ? `A refund of ${money(result.refundCents)} has been initiated and should appear within 3–5 business days.`
            : 'Your reservation has been canceled. No refund applies per the cancellation policy.'}
        </p>
        <a href="/#stay" className="cta" style={{ display: 'block', textAlign: 'center', marginTop: 20, textDecoration: 'none' }}>Book again →</a>
        <a href="/" className="modal-call">← Back to Midway</a>
      </div>
    </div>
  </section>
);

// ─── App ─────────────────────────────────────────────────────────────────────

const App = () => {
  const [step, setStep] = useState('lookup');
  const [creds, setCreds] = useState({ phone: '', email: '' });
  const [bookings, setBookings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);

  const handleFound = (found, phone, email) => {
    setCreds({ phone, email });
    setBookings(found);
    setStep('list');
  };

  const handleSelect = (b) => { setSelected(b); setStep('detail'); };

  return (
    <>
      <Nav />
      {step === 'lookup' && <Lookup onFound={handleFound} />}
      {step === 'list' && <BookingList bookings={bookings} phone={creds.phone} email={creds.email} onSelect={handleSelect} onNewLookup={() => setStep('lookup')} />}
      {step === 'detail' && selected && (
        <BookingDetail
          booking={selected}
          phone={creds.phone}
          email={creds.email}
          onEdit={() => setStep('edit')}
          onCancel={() => setStep('cancel')}
          onBack={() => setStep('list')}
        />
      )}
      {step === 'edit' && selected && (
        <EditForm
          booking={selected}
          phone={creds.phone}
          email={creds.email}
          onDone={updated => { setResult(updated); setStep('edit-done'); }}
          onBack={() => setStep('detail')}
        />
      )}
      {step === 'cancel' && selected && (
        <CancelConfirm
          booking={selected}
          phone={creds.phone}
          email={creds.email}
          onDone={r => { setResult(r); setStep('cancel-done'); }}
          onBack={() => setStep('detail')}
        />
      )}
      {step === 'edit-done' && <EditDone booking={result} />}
      {step === 'cancel-done' && <CancelDone result={result} />}
    </>
  );
};

createRoot(document.getElementById('root')).render(<App />);
