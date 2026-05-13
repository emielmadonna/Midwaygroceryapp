# API Layer

## API Principles

- Keep APIs grouped by domain.
- Validate all input server-side.
- Return predictable errors.
- Use role checks on every protected route.
- Never expose Square secrets or service-role database keys to the browser.
- Keep AI tool actions as explicit API/service methods, not free-form database access.

## Proposed Route Groups

### Public Site

- `GET /api/public/settings`
- `GET /api/public/hours`
- `GET /api/public/announcements`
- `GET /api/public/rv-sites`
- `GET /api/public/rv-availability?start=&end=`

### Booking

- `POST /api/bookings/holds`
- `DELETE /api/bookings/holds/:id`
- `POST /api/bookings/quote`
- `POST /api/bookings/checkout`
- `POST /api/bookings/confirm-payment`
- `GET /api/bookings/:bookingCode`

### Admin Bookings

- `GET /api/admin/bookings`
- `POST /api/admin/bookings`
- `PATCH /api/admin/bookings/:id`
- `POST /api/admin/bookings/:id/cancel`
- `POST /api/admin/bookings/:id/refund`
- `POST /api/admin/rv-sites/:id/block`
- `PATCH /api/admin/rv-sites/:id`

### Content

- `GET /api/admin/content`
- `PATCH /api/admin/settings`
- `PATCH /api/admin/hours`
- `POST /api/admin/announcements`
- `PATCH /api/admin/announcements/:id`

### Square

- `POST /api/square/webhook`
- `POST /api/admin/square/sync/catalog`
- `POST /api/admin/square/sync/inventory`
- `GET /api/admin/square/sales`
- `GET /api/admin/square/inventory`

### Accounting

- `GET /api/admin/accounting/summary`
- `GET /api/admin/accounting/exceptions`
- `POST /api/admin/accounting/exceptions/:id/resolve`
- `POST /api/admin/accounting/batches`
- `POST /api/admin/accounting/batches/:id/approve`
- `POST /api/admin/accounting/batches/:id/export`
- `POST /api/admin/accounting/sync/quickbooks`

### AI

- `POST /api/admin/ai/commands`
- `GET /api/admin/ai/actions`
- `POST /api/admin/ai/actions/:id/approve`
- `POST /api/admin/ai/actions/:id/reject`
- `POST /api/admin/ai/actions/:id/execute`

### Dashboard

- `GET /api/admin/dashboard/today`
- `GET /api/admin/dashboard/alerts`
- `GET /api/admin/dashboard/metrics`

## Request/Response Standards

Successful response:

```json
{
  "ok": true,
  "data": {}
}
```

Error response:

```json
{
  "ok": false,
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "That RV site is no longer available for the selected dates."
  }
}
```

## Booking Validation

The backend must validate:

- Site exists and is active.
- Dates are valid.
- Dates obey booking rules.
- Site is available.
- Hold exists and is not expired.
- Customer information is valid.
- Total price was computed server-side.
- Square payment amount matches booking total.

## Webhook Rules

- Verify webhook signatures.
- Store raw webhook payloads.
- Process idempotently.
- Record success/failure in `square_events`.
- Never assume one webhook arrives only once.

## API Versioning

Start with unversioned internal APIs during MVP if needed. Before external reuse, move to:

- `/api/v1/...`
