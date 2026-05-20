import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSquarePaymentRequest,
  buildSquareVerificationDetails,
  checkoutAmountCents,
  createPaymentIdempotencyKey,
  squareAmount,
} from '../src/lib/public-checkout.js';

test('Square checkout helpers keep wallet amount and buyer verification in sync', () => {
  const session = {
    guest: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '555-0101',
    },
    hold: {
      quote: {
        totalCents: 9500,
      },
    },
  };
  const checkout = {
    currency: 'USD',
  };
  const amountCents = checkoutAmountCents({ checkout, session });

  assert.equal(amountCents, 9500);
  assert.equal(squareAmount(amountCents), '95.00');
  assert.deepEqual(buildSquarePaymentRequest({ checkout, amountCents }), {
    countryCode: 'US',
    currencyCode: 'USD',
    total: {
      amount: '95.00',
      label: 'Midway reservation',
    },
  });
  assert.deepEqual(buildSquareVerificationDetails({ checkout, session, amountCents }), {
    amount: '95.00',
    billingContact: {
      email: 'ada@example.com',
      phone: '555-0101',
      givenName: 'Ada',
      familyName: 'Lovelace',
    },
    currencyCode: 'USD',
    intent: 'CHARGE',
  });
});

test('payment idempotency keys are unique per checkout attempt', () => {
  const first = createPaymentIdempotencyKey('MW-ABCD12', 'Apple Pay', () => 'attempt-one');
  const second = createPaymentIdempotencyKey('MW-ABCD12', 'Apple Pay', () => 'attempt-two');

  assert.equal(first, 'payment-mw-abcd12-apple-pay-attempt-one');
  assert.equal(second, 'payment-mw-abcd12-apple-pay-attempt-two');
  assert.notEqual(first, second);
});
