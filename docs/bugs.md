# Bugs, Risks, and Issue Log

This file tracks known bugs, risks, and follow-up issues. Keep it current so future agents do not rediscover the same problems.

## Status Labels

- `open`
- `investigating`
- `blocked`
- `fixed`
- `wontfix`

## Severity

- `critical`: payment, data loss, security, double-booking, public outage.
- `high`: major admin or booking flow breakage.
- `medium`: degraded workflow or confusing behavior.
- `low`: polish, copy, minor UI issue.

## Current Risks

### 001: Existing Square handler appears incomplete

- Status: fixed
- Severity: high
- Area: Square
- Notes: Legacy `src/square-handler.js` was replaced with a guarded compatibility shim. Reads now route through the provider adapter helper, and direct catalog/inventory writes throw explicit approval/audit errors instead of touching Square from legacy paths.

### 002: Existing admin auth is not production-safe

- Status: fixed
- Severity: critical
- Area: Auth
- Notes: Critical admin booking/dashboard routes now require server-side email/password session login with unique owner/employee users, disabled account support, expiring signed sessions, and role checks. Production startup requires at least one owner admin user, pbkdf2 password hashes, and `ADMIN_SESSION_SECRET`.

### 003: Existing rental model is too shallow

- Status: fixed
- Severity: high
- Area: RV booking
- Notes: Current sprint added 14 individual RV sites, map positions, amenities, server-side quote/availability/hold logic, and RV booking/hold schema. Remaining launch risks are tracked separately for persistence, admin, and payment confirmation.

### 004: Double-booking prevention must be designed carefully

- Status: fixed
- Severity: critical
- Area: RV booking
- Notes: Current sprint added overlap checks, active hold exclusion, expired hold release, Supabase exclusion constraints, stable seeded site IDs, and tests.

### 005: Square webhook processing must be idempotent

- Status: fixed
- Severity: high
- Area: Square
- Notes: Current sprint added signature verification, event normalization, `square_events` persistence, event ID dedupe, and processed-event skipping.

### 006: Instagram embed reliability

- Status: open
- Severity: medium
- Area: Public site
- Notes: Instagram embeds can fail due to browser privacy settings or platform changes. Always show a fallback profile link.

### 007: Need exact business address/phone

- Status: open
- Severity: medium
- Area: SEO/content
- Notes: Existing prototype contains an address/phone that must be confirmed before launch.

### 008: Need property map source

- Status: investigating
- Severity: high
- Area: RV map
- Notes: Current sprint added a working illustrated site plan with coordinates for 14 sites. It still needs owner approval or a real map/sketch before launch.

### 009: RV holds and bookings are not persistent

- Status: fixed
- Severity: critical
- Area: RV booking
- Notes: The public API now uses Supabase persistence when server credentials are configured, and production startup rejects memory-only booking storage unless explicitly overridden for maintenance.

### 010: Payment confirmation is not production-durable yet

- Status: fixed
- Severity: critical
- Area: Payments
- Notes: Checkout now creates a held booking, renders Square Web Payments SDK card entry on the public site, sends the tokenized source to the backend, creates the Square payment through the Payments API, confirms the booking only after payment completion, and keeps Square webhooks idempotent for follow-up reconciliation. Production startup requires live Square checkout credentials and webhook signature configuration.

### 011: Admin dashboard is still legacy/prototype

- Status: fixed
- Severity: high
- Area: Dashboard/Auth
- Notes: The admin page now uses protected API routes for today summary, booking list, manual booking, site blocks, site status, notifications, audit log, calendar view, visual property map/site status management, owner-only refunds, and role-aware employee task mode. Remaining launch choice: keep the built-in email/password session auth or swap to a dedicated identity provider.

### 012: Launch content and business facts remain unverified

- Status: open
- Severity: medium
- Area: SEO/content
- Notes: Address, phone, public brand name, Instagram handle, RV rules, prices, taxes/fees, cancellation policy, and map accuracy need owner confirmation before public launch.

## Bug Template

```text
### 000: Short title

- Status:
- Severity:
- Area:
- Reproduction:
- Expected:
- Actual:
- Notes:
```
