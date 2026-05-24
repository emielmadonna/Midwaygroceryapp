import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addLocalDateDays,
  buildSquarePaymentRequest,
  buildSquareVerificationDetails,
  checkoutAmountCents,
  createPaymentIdempotencyKey,
  dateRangeNights,
  normalizeDepartureDate,
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

test('payment idempotency keys fit Square payment limits', () => {
  const first = createPaymentIdempotencyKey('MW-ABCD12', 'Apple Pay', () => '12345678-1234-1234-1234-123456789abc');
  const second = createPaymentIdempotencyKey('MW-ABCD12', 'Apple Pay', () => 'abcdefab-1234-1234-1234-123456789abc');

  assert.equal(first.length <= 45, true);
  assert.equal(second.length <= 45, true);
  assert.notEqual(first, second);
});

test('booking date helpers keep departure after arrival', () => {
  assert.equal(addLocalDateDays('2026-03-31', 1), '2026-04-01');
  assert.equal(dateRangeNights('2026-06-10', '2026-06-13'), 3);
  assert.equal(normalizeDepartureDate({
    previousStartDate: '2026-03-10',
    nextStartDate: '2026-06-10',
    departureDate: '2026-03-13',
  }), '2026-06-13');
  assert.equal(normalizeDepartureDate({
    previousStartDate: '2026-06-10',
    nextStartDate: '2026-06-10',
    departureDate: '2026-06-09',
  }), '2026-06-11');
  assert.equal(normalizeDepartureDate({
    previousStartDate: '2026-06-10',
    nextStartDate: '2026-06-10',
    departureDate: '2026-06-12',
  }), '2026-06-12');
});
