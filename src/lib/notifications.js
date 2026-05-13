export function createNotificationService({
  store = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    async bookingConfirmed(booking) {
      const recorded = [];
      const adminNotification = buildAdminBookingNotification(booking);
      recorded.push(await store?.recordNotification?.(adminNotification) ?? adminNotification);

      if (booking.customerEmail) {
        recorded.push(await sendCustomerBookingEmail({ booking, fetchImpl, store }));
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
    subject: `Midway RV booking ${booking.bookingCode}`,
    body: `Your Midway RV booking is confirmed for ${booking.startDate} to ${booking.endDate}.`,
    bookingCode: booking.bookingCode,
    status: 'queued',
  };
}

async function sendCustomerBookingEmail({ booking, fetchImpl, store }) {
  const notification = buildCustomerBookingNotification(booking);
  const provider = await resolveProviderConfig(store, 'email');
  const webhookUrl = readConfig(provider, 'bookingWebhookUrl')
    || readConfig(provider, 'webhookUrl');
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
    return store?.recordNotification?.({
      ...notification,
      status: 'failed',
      errorMessage: error.message,
    }) ?? {
      ...notification,
      status: 'failed',
      errorMessage: error.message,
    };
  }
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
    await store?.recordNotification?.({
      ...notification,
      status: 'failed',
      errorMessage: error.message,
    });
  }
}

async function resolveProviderConfig(store, providerKey) {
  return await store?.getProviderConfig?.(providerKey) ?? {};
}

function readConfig(config, name) {
  const value = config?.[name];
  return typeof value === 'string' ? value.trim() : value;
}
