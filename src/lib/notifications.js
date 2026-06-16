export function createNotificationService({
  store = null,
  fetchImpl = globalThis.fetch,
  env = {},
} = {}) {
  return {
    async bookingConfirmed(booking) {
      const recorded = [];
      const adminNotification = buildAdminBookingNotification(booking);
      recorded.push(await store?.recordNotification?.(adminNotification) ?? adminNotification);

      if (booking.customerEmail) {
        recorded.push(await sendCustomerBookingEmail({ booking, fetchImpl, store, env }));
      }

      await sendSlackBookingNotification({ booking, fetchImpl, store });
      return recorded;
    },
  };
}

function buildAdminBookingNotification(booking) {
  return {
    type: 'admin.booking_confirmed',
    channel: 'dashboard',
    recipient: 'owner',
    subject: `New RV booking ${booking.bookingCode}`,
    body: `${booking.customerName} booked site ${booking.rvSiteId} from ${booking.startDate} to ${booking.endDate}.`,
    bookingCode: booking.bookingCode,
    status: 'queued',
  };
}

function buildCustomerBookingNotification(booking) {
  return {
    type: 'customer.booking_confirmed',
    channel: 'email',
    recipient: booking.customerEmail,
    subject: `Booking confirmed – ${booking.bookingCode}`,
    body: `Your Midway RV booking is confirmed for ${booking.startDate} to ${booking.endDate}.`,
    bookingCode: booking.bookingCode,
    status: 'queued',
  };
}

async function sendCustomerBookingEmail({ booking, fetchImpl, store, env }) {
  const notification = buildCustomerBookingNotification(booking);
  const resendApiKey = env?.RESEND_API_KEY;

  if (resendApiKey) {
    return sendViaResend({ booking, notification, resendApiKey, fetchImpl, store, env });
  }

  const provider = await resolveProviderConfig(store, 'email');
  const webhookUrl = readConfig(provider, 'bookingWebhookUrl') || readConfig(provider, 'webhookUrl');
  const from = readConfig(provider, 'from');

  if (!webhookUrl) {
    return store?.recordNotification?.(notification) ?? notification;
  }

  try {
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(from ? { from } : {}),
        to: booking.customerEmail,
        subject: notification.subject,
        text: notification.body,
        bookingCode: booking.bookingCode,
      }),
    });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
    return store?.recordNotification?.({ ...notification, status: 'sent' }) ?? { ...notification, status: 'sent' };
  } catch (error) {
    return store?.recordNotification?.({ ...notification, status: 'failed', errorMessage: error.message })
      ?? { ...notification, status: 'failed', errorMessage: error.message };
  }
}

async function sendViaResend({ booking, notification, resendApiKey, fetchImpl, store, env }) {
  const from = env?.FROM_EMAIL ?? 'Midway RV Park <bookings@midwayrv.com>';
  const html = buildBookingConfirmationHtml(booking, env);

  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [booking.customerEmail],
        subject: notification.subject,
        html,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Resend returned ${response.status}: ${body}`);
    }
    return store?.recordNotification?.({ ...notification, status: 'sent' }) ?? { ...notification, status: 'sent' };
  } catch (error) {
    return store?.recordNotification?.({ ...notification, status: 'failed', errorMessage: error.message })
      ?? { ...notification, status: 'failed', errorMessage: error.message };
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatCents(cents) {
  if (!cents && cents !== 0) return '';
  return `$${(cents / 100).toFixed(2)}`;
}

function buildBookingConfirmationHtml(booking, env = {}) {
  const siteUrl = (env?.SITE_URL ?? '').replace(/\/$/, '');
  const logoUrl = siteUrl ? `${siteUrl}/assets/midway-logo.png` : null;

  const siteDisplay = booking.siteLines?.length
    ? booking.siteLines.map(s => `Site ${s.siteNumber}`).join(', ')
    : booking.siteNumber
      ? `Site ${booking.siteNumber}`
      : booking.rvSiteId ?? 'Your site';

  const nights = booking.nights ?? 1;
  const guests = booking.guests ?? 1;
  const vehicles = booking.vehicles ?? 1;

  const priceRows = [
    booking.subtotalCents != null && `
      <tr>
        <td style="padding:6px 0;color:#555;font-size:14px;">${nights} night${nights !== 1 ? 's' : ''} × ${formatCents(booking.nightlyPriceCents ?? Math.round(booking.subtotalCents / nights))}</td>
        <td style="padding:6px 0;color:#333;font-size:14px;text-align:right;">${formatCents(booking.subtotalCents)}</td>
      </tr>`,
    booking.feeCents > 0 && `
      <tr>
        <td style="padding:6px 0;color:#555;font-size:14px;">Extra vehicle fee</td>
        <td style="padding:6px 0;color:#333;font-size:14px;text-align:right;">${formatCents(booking.feeCents)}</td>
      </tr>`,
    booking.taxCents > 0 && `
      <tr>
        <td style="padding:6px 0;color:#555;font-size:14px;">Tax</td>
        <td style="padding:6px 0;color:#333;font-size:14px;text-align:right;">${formatCents(booking.taxCents)}</td>
      </tr>`,
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Booking Confirmed</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f0;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          ${logoUrl ? `<tr>
            <td style="background-color:#ffffff;border-radius:8px 8px 0 0;padding:24px 40px;text-align:center;border-bottom:1px solid #efefef;">
              <img src="${escHtml(logoUrl)}" alt="Midway Gas &amp; Grocery" width="160" style="display:block;margin:0 auto;max-width:160px;height:auto;" />
            </td>
          </tr>` : ''}

          <!-- Header -->
          <tr>
            <td style="background-color:#1a3d2b;${logoUrl ? '' : 'border-radius:8px 8px 0 0;'}padding:32px 40px;text-align:center;">
              <p style="margin:0 0 4px;color:#a8d5b5;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Midway RV Park</p>
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Booking Confirmed</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:40px;">

              <p style="margin:0 0 24px;color:#333;font-size:16px;line-height:1.5;">
                Hi ${escHtml(booking.customerName ?? 'there')},<br />
                Your booking is confirmed. We look forward to hosting you!
              </p>

              <!-- Booking code badge -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f7f3;border-radius:6px;margin-bottom:28px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px;color:#555;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Booking reference</p>
                    <p style="margin:0;color:#1a3d2b;font-size:22px;font-weight:700;letter-spacing:1px;">${escHtml(booking.bookingCode)}</p>
                  </td>
                </tr>
              </table>

              <!-- Stay details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding-bottom:16px;border-bottom:1px solid #eee;">
                    <p style="margin:0 0 12px;color:#1a3d2b;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Stay details</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
                    <table width="100%">
                      <tr>
                        <td style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;width:40%;">Site</td>
                        <td style="color:#222;font-size:14px;font-weight:600;">${escHtml(siteDisplay)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
                    <table width="100%">
                      <tr>
                        <td style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;width:40%;">Arrival</td>
                        <td style="color:#222;font-size:14px;">${escHtml(formatDate(booking.startDate))}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
                    <table width="100%">
                      <tr>
                        <td style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;width:40%;">Departure</td>
                        <td style="color:#222;font-size:14px;">${escHtml(formatDate(booking.endDate))}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
                    <table width="100%">
                      <tr>
                        <td style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;width:40%;">Duration</td>
                        <td style="color:#222;font-size:14px;">${nights} night${nights !== 1 ? 's' : ''}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;">
                    <table width="100%">
                      <tr>
                        <td style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;width:40%;">Guests / Vehicles</td>
                        <td style="color:#222;font-size:14px;">${guests} guest${guests !== 1 ? 's' : ''} &middot; ${vehicles} vehicle${vehicles !== 1 ? 's' : ''}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Price breakdown -->
              ${booking.totalCents != null ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding-bottom:16px;border-bottom:1px solid #eee;">
                    <p style="margin:0;color:#1a3d2b;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Payment summary</p>
                  </td>
                </tr>
                ${priceRows}
                <tr>
                  <td style="padding-top:12px;border-top:2px solid #1a3d2b;">
                    <table width="100%">
                      <tr>
                        <td style="color:#1a3d2b;font-size:15px;font-weight:700;">Total paid</td>
                        <td style="color:#1a3d2b;font-size:15px;font-weight:700;text-align:right;">${formatCents(booking.totalCents)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              ` : ''}

              <!-- Cancellation policy -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fffbf0;border-left:3px solid #e8a020;border-radius:0 4px 4px 0;margin-bottom:28px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0 0 4px;color:#b07318;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Cancellation policy</p>
                    <p style="margin:0;color:#555;font-size:13px;line-height:1.5;">Full refund if cancelled 30+ days before arrival &middot; 50% refund 14–30 days &middot; No refund under 14 days.</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:#555;font-size:14px;line-height:1.6;">
                Questions? Reply to this email or call us and we'll be happy to help.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f0f0eb;border-radius:0 0 8px 8px;padding:20px 40px;text-align:center;">
              <p style="margin:0;color:#888;font-size:12px;line-height:1.6;">
                Midway RV Park &middot; This is a transactional email confirming your booking.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function sendSlackBookingNotification({ booking, fetchImpl, store }) {
  const provider = await resolveProviderConfig(store, 'slack');
  const webhookUrl = readConfig(provider, 'webhookUrl');
  if (!webhookUrl) return;

  const notification = {
    type: 'admin.booking_confirmed',
    channel: 'slack',
    recipient: 'owner',
    subject: `New RV booking ${booking.bookingCode}`,
    body: `${booking.customerName} booked ${booking.rvSiteId} for ${booking.nights} night(s).`,
    bookingCode: booking.bookingCode,
    status: 'sent',
  };

  try {
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `New Midway RV booking: ${booking.bookingCode}\n${booking.customerName} booked ${booking.rvSiteId} from ${booking.startDate} to ${booking.endDate}.`,
      }),
    });
    if (!response.ok) throw new Error(`Slack returned ${response.status}`);
    await store?.recordNotification?.(notification);
  } catch (error) {
    await store?.recordNotification?.({ ...notification, status: 'failed', errorMessage: error.message });
  }
}

async function resolveProviderConfig(store, providerKey) {
  return await store?.getProviderConfig?.(providerKey) ?? {};
}

function readConfig(config, name) {
  const value = config?.[name];
  return typeof value === 'string' ? value.trim() : value;
}
