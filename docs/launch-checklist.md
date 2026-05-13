# Launch Checklist

Audit date: May 12, 2026

Scope checked against `docs/MIDWAY_REBUILD_PLAN.md`, `docs/mvp-plan.md`, `docs/roadmap.md`, and current code.

## Done

- Public Midway single-page site exists and builds with Vite.
- Public API shell exists in `api-server.js` with `/api/public/bootstrap`, booking quote, hold, checkout, and Square webhook routes.
- Public bootstrap can collapse optional fuel/product/event/coffee sections through feature flags.
- 14 seeded RV sites exist with site numbers, amenities, map positions, rates, amp/type/shade, and Square SKU hooks.
- RV quote, availability, date overlap, active hold, and expired hold logic exists and is covered by node tests.
- Checkout creates a short-lived hold, renders Square Web Payments SDK card entry on the site, and confirms the booking after the backend creates a Square payment.
- Checkout requires a configured Square provider connection; missing or failed Square provider configuration is never converted to a local payment.
- Production Square checkout config validation rejects missing credentials and sandbox mode in production.
- Square catalog items can be normalized into public products; public bootstrap tolerates Square product sync failure.
- Square webhook signature verification and event normalization helpers exist.
- Paid Square webhook events can confirm bookings idempotently.
- Supabase schema now includes seeded RV site, amenity, booking, hold, and idempotent Square event tables.
- The public API can use Supabase server persistence when `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.
- Square webhook events are recorded by event ID and repeated processed events are ignored idempotently.
- Production startup fails fast unless Supabase persistence, Square live checkout, Square webhook signature, public site URL, and RV variation IDs are configured.
- Protected admin API routes exist for owner/employee sessions, dashboard summary, booking list, manual booking, site blocks, site status updates, notifications, and audit log.
- Admin UI now uses server-side email/password login sessions with unique owner/employee users instead of shared local passwords or static admin tokens.
- Admin UI includes feature-flagged calendar, visual property map/site inspector, richer employee task mode, owner-only manual booking controls, and owner-only refund actions.
- Feature flags are evaluated through a canonical server-side matrix with public aliases for current UI compatibility.
- The landing page includes a feature-flagged Instagram section with an embedded profile frame, optional curated post/photo embeds from tenant site settings, and fallback profile link.
- Owner-only refund API calls the configured Square provider, marks bookings refunded, and records audit entries.
- Booking confirmations create dashboard/customer notification records, with optional email webhook and Slack handoff.
- Legacy `src/square-handler.js` no longer initializes a broken Square client at import time; unsafe catalog/inventory writes are explicitly disabled pending audited provider routes.
- Production startup fails fast unless at least one owner admin user, `ADMIN_SESSION_SECRET`, and booking email webhook are configured.
- Static/API visual smoke coverage checks the public shell, Instagram embed, admin login/session flow, and feature-gated admin surfaces until browser automation is installed.
- `npm run smoke` passes 45 node tests and a Vite production build.

## In Progress

- Square Web Payments SDK is wired for card tokenization, backend Payments API capture, and buyer verification token forwarding. Production still needs live tenant provider connection, secure hosting, and CSP validation.
- Square catalog/product sync is partially implemented through the public API path; direct catalog/inventory write workflows still need audited admin routes before use.
- Public frontend has a site map and date-aware availability calls, but the property map is still an illustrative layout pending owner confirmation.
- Feature flags now resolve canonical platform/tenant/location/role/environment-style keys from defaults and overrides. Database-backed flag editing UI is still not built.

## Blocked

- Confirm exact public business name, address, phone, Instagram handle, and any launch Instagram post URLs before launch metadata and contact links are treated as final.
- Confirm the RV site count, numbered site list, amenities, prices, taxes/fees, check-in/check-out, cancellation rules, and pet/monthly-stay policies.
- Confirm Square production account, application ID, location ID, webhook URL/signature key, and catalog variation IDs.
- Provide or approve the RV property map source; current coordinates are a working schematic.
- Choose final identity provider path if the built-in email/password session auth is not acceptable for launch.
- Choose and configure the email webhook/provider plus sender domain before booking confirmations can be launch-ready.

## Next

- Add production launch content pass for NAP, SEO metadata, structured data, Instagram fallback, and image alt text.
- Add real browser smoke coverage for public mobile/desktop load, RV map visibility, disabled section behavior, and checkout failure messaging once Playwright/Puppeteer or the browser plugin is available.
