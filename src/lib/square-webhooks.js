export function normalizeSquareWebhookEvent(event = {}) {
  const type = event.type || '';
  const object = event.data?.object || {};
  const payment = object.payment || object;
  const order = object.order || object;

  if (type.startsWith('payment.')) {
    return {
      provider: 'square',
      type,
      eventId: event.event_id || event.id || null,
      status: payment.status,
      bookingCode: payment.note || payment.reference_id || payment.order_id || null,
      squareOrderId: payment.order_id || null,
      squarePaymentId: payment.id || null,
      paid: ['COMPLETED', 'APPROVED'].includes(payment.status),
    };
  }

  if (type.startsWith('order.')) {
    return {
      provider: 'square',
      type,
      eventId: event.event_id || event.id || null,
      status: order.state,
      bookingCode: order.reference_id || order.metadata?.booking_code || null,
      squareOrderId: order.id || null,
      squarePaymentId: null,
      paid: order.state === 'COMPLETED',
    };
  }

  return {
    provider: 'square',
    type,
    eventId: event.event_id || event.id || null,
    status: null,
    bookingCode: null,
    squareOrderId: null,
    squarePaymentId: null,
    paid: false,
  };
}
