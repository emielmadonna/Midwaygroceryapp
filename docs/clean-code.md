# Clean Code Standards

## Purpose

MidwayOS should be easy for future agents and developers to understand quickly.

The code should optimize for:

- Clear feature boundaries.
- Predictable file names.
- Small functions.
- Explicit data flow.
- Safe API calls.
- Minimal cleverness.
- Comments that explain why, not obvious what.

## File Organization

Use domain-first organization for business features:

```text
features/
  booking/
  rv-map/
  providers/
  payments/
  inventory/
  fuel/
  ai/
  content/
  auth/
```

Shared utilities should be boring and narrow:

```text
lib/
  dates/
  money/
  validation/
  permissions/
  audit/
```

Avoid dumping unrelated helpers into one large `utils` file.

## Naming

Use names that describe business meaning:

- `rvBooking`, not `item`
- `bookingHold`, not `temp`
- `squarePaymentId`, not `externalId`
- `nightlyPriceCents`, not `price`

Use consistent suffixes:

- `*Id` for local IDs.
- `square*Id` for Square IDs.
- `*Cents` for money.
- `*At` for timestamps.
- `*Date` for booking dates.

## Comments

Comments are encouraged when they prevent mistakes.

Good comments explain:

- Business rules.
- External API quirks.
- Security boundaries.
- Non-obvious date/payment behavior.
- Why a choice was made.

Avoid comments that repeat the code.

Example:

```js
// Holds prevent two customers from checking out the same site at the same time.
// A hold is not a booking until Square payment succeeds.
```

Bad:

```js
// Set status to confirmed.
booking.status = 'confirmed';
```

## Function Design

Prefer small functions with one responsibility:

- `calculateBookingQuote`
- `assertSiteAvailable`
- `createBookingHold`
- `createSquareOrder`
- `confirmPaidBooking`

Avoid functions that mix:

- UI rendering
- database writes
- Square calls
- AI logic
- permission checks

## Money

- Store money in cents.
- Format money only at the UI edge.
- Never trust browser-calculated totals.
- Recalculate totals on the backend before payment.

## Dates

- RV stays use local dates in Midway's timezone.
- Timestamps use timezone-aware values.
- Do not compare date strings casually.
- Centralize date utilities.

## Square

- Keep Square calls inside the Square provider adapter.
- Store Square IDs on related local records.
- Use idempotency keys for payment/order operations.
- Webhooks must be idempotent.
- Do not expose Square access tokens in frontend code.

## Provider Adapters

- Keep provider SDKs out of feature UI and domain logic.
- Code against internal interfaces such as `PaymentProvider`, `AccountingProvider`, and `MessagingProvider`.
- Store internal IDs separately from provider IDs.
- Normalize provider statuses before they reach business logic.
- Keep export-only/accountant-review mode available for accounting.
- Use OAuth connection objects, not scattered access tokens.

## AI

- AI tools must be typed and permissioned.
- Do not let AI call arbitrary SQL.
- Do not let AI call arbitrary Square endpoints.
- Store every command and action.
- Require confirmation for medium/high risk actions.

## CSS and UI

- Use design tokens for color, spacing, radius, and type.
- Avoid one-off hard-coded colors.
- Keep public and admin styles separate where possible.
- Do not nest cards inside cards.
- Keep mobile layouts explicit.

## Testing Expectations

High-priority tests:

- Booking overlap prevention.
- Hold expiration.
- Payment confirmation.
- Webhook idempotency.
- Permission checks.
- Quote calculation.
- Role-limited admin actions.
- Provider adapter contract tests.
- OAuth connect/reconnect/disconnect flows.
- MCP tool permission tests.
- Visual regression for public site, RV map, and admin dashboard.

## Refactoring Rules

- Do not rewrite working modules without reason.
- Prefer additive, feature-scoped changes.
- Keep unrelated formatting churn out of functional changes.
- Update docs when changing architecture, data model, API contracts, or AI permissions.
