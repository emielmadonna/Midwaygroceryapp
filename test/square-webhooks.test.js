import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSquareWebhookEvent } from '../src/lib/square-webhooks.js';

test('normalizes completed Square payment events', () => {
  const event = normalizeSquareWebhookEvent({
    type: 'payment.updated',
    event_id: 'evt-1',
    data: {
      object: {
        payment: {
          id: 'pay-1',
          order_id: 'order-1',
          status: 'COMPLETED',
          reference_id: 'MW-ABC123',
        },
      },
    },
  });

  assert.deepEqual(event, {
    provider: 'square',
    type: 'payment.updated',
    eventId: 'evt-1',
    status: 'COMPLETED',
    bookingCode: 'MW-ABC123',
    squareOrderId: 'order-1',
    squarePaymentId: 'pay-1',
    paid: true,
  });
});

test('does not mark failed payments as paid', () => {
  const event = normalizeSquareWebhookEvent({
    type: 'payment.updated',
    data: {
      object: {
        payment: {
          id: 'pay-1',
          order_id: 'order-1',
          status: 'FAILED',
        },
      },
    },
  });

  assert.equal(event.paid, false);
});
