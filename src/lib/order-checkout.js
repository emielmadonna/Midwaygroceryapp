import { squareRequest, validateSquareCheckoutConfig } from './square-api.js';

// Order-ahead checkout: builds a real Square Order from the cart (Square prices the
// line items from the catalog, so totals can't be tampered with), takes a Web Payments
// card payment against it, and emails a confirmation. Square is the order system of record.

const PAYMENT_KEY_MAX = 45;

function shortKey(prefix, code) {
  return `${prefix}-${code}`.slice(0, PAYMENT_KEY_MAX);
}

export async function createSquareOrder({ items = [], orderCode, customer = {}, env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = validateSquareCheckoutConfig({ ...env, checkoutSurface: 'payment-link' });
  const lineItems = items
    .map(i => ({ catalog_object_id: String(i.variationId || ''), quantity: String(Math.max(1, parseInt(i.quantity, 10) || 1)) }))
    .filter(i => i.catalog_object_id);
  if (!lineItems.length) throw new Error('Your cart is empty.');

  const metadata = {
    order_code: orderCode,
    fulfillment: 'pickup',
    pickup: 'wed-afternoon',
  };
  const customerName = String(customer.name || '').slice(0, 60);
  const customerPhone = String(customer.phone || '').slice(0, 30);
  if (customerName) metadata.customer_name = customerName;
  if (customerPhone) metadata.customer_phone = customerPhone;

  const res = await squareRequest('/v2/orders', {
    method: 'POST',
    env,
    fetchImpl,
    body: {
      idempotency_key: shortKey('ord', orderCode),
      order: {
        location_id: cfg.locationId,
        reference_id: orderCode,
        metadata,
        line_items: lineItems,
      },
    },
  });
  const order = res.order ?? {};
  return {
    orderId: order.id,
    amountCents: Number(order.total_money?.amount ?? 0),
    currency: order.total_money?.currency ?? 'USD',
  };
}

export async function retrieveSquareOrder({ orderId, env, fetchImpl = globalThis.fetch } = {}) {
  const res = await squareRequest(`/v2/orders/${encodeURIComponent(orderId)}`, { env, fetchImpl });
  const order = res.order ?? {};
  return {
    orderId: order.id,
    amountCents: Number(order.total_money?.amount ?? 0),
    currency: order.total_money?.currency ?? 'USD',
    state: order.state,
  };
}

export async function createOrderPayment({
  orderId,
  amountCents,
  currency = 'USD',
  sourceId,
  verificationToken,
  idempotencyKey,
  orderCode,
  buyerEmail,
  env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const cfg = validateSquareCheckoutConfig(env);
  if (!sourceId) throw new Error('A payment token is required.');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Order amount is invalid.');

  const payload = {
    idempotency_key: shortKey('pay', idempotencyKey || orderCode),
    source_id: sourceId,
    amount_money: { amount: amountCents, currency },
    location_id: cfg.locationId,
    order_id: orderId,
    reference_id: orderCode,
    note: `Order ahead ${orderCode}`,
    autocomplete: true,
  };
  if (buyerEmail) payload.buyer_email_address = buyerEmail;
  if (verificationToken) payload.verification_token = verificationToken;

  const res = await squareRequest('/v2/payments', { method: 'POST', body: payload, env, fetchImpl });
  const payment = res.payment ?? {};
  return {
    paymentId: payment.id,
    status: payment.status,
    amountCents: Number(payment.amount_money?.amount ?? amountCents),
    currency: payment.amount_money?.currency ?? currency,
    receiptUrl: payment.receipt_url ?? null,
    orderId: payment.order_id ?? orderId,
  };
}

function formatCents(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}
function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildOrderHtml(order = {}, env = {}) {
  const siteUrl = (env?.SITE_URL ?? '').replace(/\/$/, '');
  const logoUrl = siteUrl ? `${siteUrl}/assets/midway-logo.png` : null;
  const items = Array.isArray(order.items) ? order.items : [];
  const itemCount = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

  const rows = items.map(it => `
    <tr>
      <td style="padding:11px 0;border-bottom:1px solid #f0f0ec;color:#222;font-size:14px;line-height:1.4;">
        <span style="display:inline-block;min-width:30px;color:#8c8a82;font-weight:600;">${esc(it.quantity)}×</span>${esc(it.name)}
      </td>
      <td style="padding:11px 0;border-bottom:1px solid #f0f0ec;color:#222;font-size:14px;text-align:right;white-space:nowrap;">${formatCents(it.lineCents)}</td>
    </tr>`).join('');

  const itemsBlock = rows
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
         <tr><td colspan="2" style="padding-bottom:10px;color:#1B1B1D;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Your box${itemCount ? ` · ${itemCount} item${itemCount === 1 ? '' : 's'}` : ''}</td></tr>
         ${rows}
         <tr>
           <td style="padding-top:14px;color:#1B1B1D;font-size:16px;font-weight:700;">Total paid</td>
           <td style="padding-top:14px;color:#1B1B1D;font-size:16px;font-weight:700;text-align:right;">${formatCents(order.amountCents)}</td>
         </tr>
       </table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
         <tr><td style="color:#1B1B1D;font-size:16px;font-weight:700;">Total paid</td>
         <td style="color:#1B1B1D;font-size:16px;font-weight:700;text-align:right;">${formatCents(order.amountCents)}</td></tr>
       </table>`;

  const receiptLink = order.receiptUrl
    ? `<p style="margin:18px 0 0;text-align:center;"><a href="${esc(order.receiptUrl)}" style="color:#2a9da2;font-size:13px;text-decoration:none;">View Square receipt →</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Order received</title></head>
<body style="margin:0;padding:0;background:#ece9e1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ece9e1;padding:32px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

      ${logoUrl ? `<tr><td style="background:#0F0F11;border-radius:10px 10px 0 0;padding:26px 40px 0;text-align:center;"><img src="${esc(logoUrl)}" alt="Midway Gas &amp; Grocery" width="150" style="display:block;margin:0 auto;max-width:150px;height:auto;filter:invert(1) brightness(1.7);"/></td></tr>` : ''}

      <tr><td style="background:#0F0F11;${logoUrl ? '' : 'border-radius:10px 10px 0 0;'}padding:${logoUrl ? '18' : '34'}px 40px 34px;text-align:center;">
        <p style="margin:0 0 6px;color:#54c6cb;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;">Order received</p>
        <h1 style="margin:0;color:#F1F0EB;font-size:27px;font-weight:600;letter-spacing:-0.3px;">Thanks${order.customerName ? `, ${esc(order.customerName.split(' ')[0])}` : ''}.</h1>
      </td></tr>

      <tr><td style="background:#ffffff;padding:36px 40px;">
        <p style="margin:0 0 24px;color:#333;font-size:16px;line-height:1.55;">
          We've got your order. We'll shop and pack your box midweek — it'll be ready for pickup <strong style="color:#1B1B1D;">Wednesday afternoon</strong> at the Midway counter.
        </p>

        <!-- order code + pickup -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:26px;border-collapse:separate;border-spacing:0;">
          <tr>
            <td width="50%" style="background:#f5f3ec;border-radius:8px 0 0 8px;padding:16px 18px;">
              <p style="margin:0 0 4px;color:#8c8a82;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;">Order reference</p>
              <p style="margin:0;color:#1B1B1D;font-size:19px;font-weight:700;letter-spacing:1px;">${esc(order.orderCode || '')}</p>
            </td>
            <td width="50%" style="background:#eafafa;border-radius:0 8px 8px 0;padding:16px 18px;border-left:1px solid #fff;">
              <p style="margin:0 0 4px;color:#2a9da2;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;">Pickup</p>
              <p style="margin:0;color:#1B1B1D;font-size:15px;font-weight:600;line-height:1.35;">Wednesday afternoon<br/>at the counter</p>
            </td>
          </tr>
        </table>

        ${itemsBlock}
        ${receiptLink}

        <p style="margin:26px 0 0;color:#555;font-size:14px;line-height:1.6;">
          Questions about your order? Call us at <a href="tel:+15095961076" style="color:#1B1B1D;font-weight:600;text-decoration:none;">(509) 596-1076</a> — we're happy to help.
        </p>
      </td></tr>

      <tr><td style="background:#f5f3ec;border-radius:0 0 10px 10px;padding:22px 40px;text-align:center;">
        <p style="margin:0 0 4px;color:#555;font-size:13px;line-height:1.6;">Midway Gas &amp; Grocery · 14193 Chiwawa Loop RD, Leavenworth, WA 98826</p>
        <p style="margin:0;color:#999;font-size:11px;">Pickup only — no delivery. Order by Monday 12 PM for Wednesday pickup.</p>
      </td></tr>

    </table>
  </td></tr></table>
</body></html>`;
}

async function sendResendEmail({ to, subject, html, env = {}, fetchImpl = globalThis.fetch } = {}) {
  const resendApiKey = env?.RESEND_API_KEY;
  if (!resendApiKey || !to) return { sent: false, reason: 'no-email-or-key' };
  const from = env?.FROM_EMAIL ?? 'Midway Gas & Grocery <orders@midwayplain.com>';
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) return { sent: false, reason: `resend ${res.status}` };
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

export async function sendOrderConfirmationEmail({ order, env = {}, fetchImpl = globalThis.fetch } = {}) {
  return sendResendEmail({ to: order.customerEmail, subject: `Order received – ${order.orderCode}`, html: buildOrderHtml(order, env), env, fetchImpl });
}

function buildOwnerOrderHtml(order = {}, env = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  const rows = items.map(it => `
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#222;"><b>${esc(it.quantity)}×</b> ${esc(it.name)}</td>
    <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#222;text-align:right;">${formatCents(it.lineCents)}</td></tr>`).join('');
  const contactRow = (label, value, href) => value
    ? `<tr><td style="padding:5px 0;color:#888;font-size:13px;width:90px;">${label}</td><td style="padding:5px 0;color:#222;font-size:14px;">${href ? `<a href="${esc(href)}" style="color:#1B1B1D;">${esc(value)}</a>` : esc(value)}</td></tr>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;background:#ece9e1;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ece9e1;padding:28px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;">
      <tr><td style="background:#0F0F11;padding:22px 32px;">
        <p style="margin:0 0 4px;color:#54c6cb;font-size:11px;letter-spacing:2px;text-transform:uppercase;">New pickup order</p>
        <h1 style="margin:0;color:#F1F0EB;font-size:22px;font-weight:600;">${esc(order.orderCode || '')} · ${formatCents(order.amountCents)} paid</h1></td></tr>
      <tr><td style="padding:26px 32px;">
        <p style="margin:0 0 14px;color:#1B1B1D;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Customer</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          ${contactRow('Name', order.customerName)}
          ${contactRow('Phone', order.customerPhone, order.customerPhone ? `tel:${String(order.customerPhone).replace(/[^\\d+]/g,'')}` : '')}
          ${contactRow('Email', order.customerEmail, order.customerEmail ? `mailto:${order.customerEmail}` : '')}
          ${contactRow('Pickup', 'Wednesday afternoon · at the counter')}
        </table>
        <p style="margin:0 0 10px;color:#1B1B1D;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Order</p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}
          <tr><td style="padding-top:12px;font-size:15px;font-weight:700;color:#1B1B1D;">Total paid</td>
          <td style="padding-top:12px;font-size:15px;font-weight:700;color:#1B1B1D;text-align:right;">${formatCents(order.amountCents)}</td></tr>
        </table>
        ${order.receiptUrl ? `<p style="margin:18px 0 0;"><a href="${esc(order.receiptUrl)}" style="color:#2a9da2;font-size:13px;">Square receipt →</a></p>` : ''}
      </td></tr>
    </table></td></tr></table></body></html>`;
}

export async function sendOwnerOrderEmail({ order, ownerEmail, env = {}, fetchImpl = globalThis.fetch } = {}) {
  return sendResendEmail({
    to: ownerEmail,
    subject: `New pickup order ${order.orderCode} — ${formatCents(order.amountCents)}`,
    html: buildOwnerOrderHtml(order, env),
    env,
    fetchImpl,
  });
}
