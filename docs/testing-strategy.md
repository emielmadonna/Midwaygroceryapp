# Testing Strategy

## Goal

MidwayOS should be regression-proof from the start.

Every phase should add tests around the business rules that would hurt the store if they broke: bookings, payments, provider sync, accounting, inventory, permissions, and AI/MCP actions.

## Test Pyramid

### Unit Tests

Fast tests for pure logic:

- booking quote calculation
- date overlap detection
- hold expiration
- money formatting/calculation
- tax/fee calculation
- permission decisions
- provider status mapping
- inventory threshold logic
- feature flag evaluation
- frontend section config parsing

### Integration Tests

Service-level tests with database/API boundaries:

- create booking hold
- prevent double booking
- confirm booking after paid event
- process provider webhook idempotently
- create accounting batch
- resolve accounting exception
- role-limited admin action
- MCP tool permission check
- feature-disabled API behavior
- frontend preview/publish behavior

### Contract Tests

Adapter tests for provider boundaries:

- Square payment adapter
- QuickBooks accounting adapter
- export-only accounting adapter
- SMS/email adapters
- OAuth connection lifecycle

### End-to-End Tests

Browser-level flows:

- public site loads
- customer selects RV dates/site
- customer reaches checkout
- successful payment confirms booking in sandbox
- admin sees booking
- owner updates hours/content
- employee cannot access owner-only settings

### Visual Regression Tests

Needed for:

- public homepage desktop/mobile
- RV map desktop/mobile
- booking bottom sheet
- admin dashboard mobile
- each enabled frontend skin
- accounting exception queue

Current harness:

- `npm run smoke:visual` runs static/API visual smoke checks without requiring a browser.
- `npm run smoke:browser:availability` reports whether Playwright, Puppeteer, or an explicitly exposed browser plugin runtime is available.
- Browser-backed mobile visual smoke is skipped when no automation runtime is installed. This is intentional; the repository should not claim screenshot coverage until a browser runner is present.

To enable automated browser visual smoke in CI:

1. Install one browser runner, preferably Playwright: `npm install -D playwright`.
2. Install its browser binaries in CI: `npx playwright install --with-deps chromium`.
3. Run `npm run smoke:browser:availability`.
4. Set `BROWSER_VISUAL_SMOKE=required` in CI once browser automation is mandatory; the availability test will then fail instead of skipping when no runner is detected.

The Codex Browser plugin can be used for manual local inspection, but it is not assumed by `node --test` unless the runtime explicitly exposes that capability.

### Accessibility Tests

Required for:

- keyboard navigation
- color contrast
- form labels
- tap target sizes
- focus states

## Critical Regression Suite

This suite must pass before any release:

- No double-booking for same site/date range.
- Booking is not confirmed before payment success.
- Expired holds release availability.
- Payment webhook retries do not duplicate bookings.
- Refund webhook updates booking/payment state once.
- Employee cannot issue refund.
- Employee cannot sync accounting batch.
- Owner can approve high-risk action.
- AI/MCP cannot bypass permissions.
- Provider tokens are not exposed to frontend.
- Square/QuickBooks unavailable does not break public site.
- Disabled features are blocked from UI, API, and MCP.
- Frontend config renders only enabled sections.
- Theme skins pass visual baseline.

## Test Harness Recommendation

Recommended tools:

- Unit/integration: Vitest
- Browser/E2E: Playwright
- Accessibility: axe-core with Playwright
- Visual regression: Playwright screenshots
- API test doubles: MSW or provider-specific fake clients
- Database tests: isolated Supabase/Postgres test database or local test container

## Provider Sandbox Strategy

Payment and accounting providers must be tested in sandbox/stub mode before live use.

Modes:

- `test_double`: deterministic tests
- `sandbox`: provider sandbox APIs
- `production`: live provider APIs

Production mode should require explicit environment configuration.

## CI Requirements

Every pull request should run:

- lint
- typecheck if using TypeScript
- unit tests
- integration tests
- E2E smoke tests
- accessibility smoke checks
- build

Release candidates should also run:

- full E2E
- visual regression
- provider sandbox tests
- migration tests

## Test Data

Maintain stable fixtures:

- 14 RV sites
- site amenities
- sample bookings
- sample holds
- sample Square payment events
- sample payout events
- sample accounting exceptions
- sample employee/owner users

## Bug Policy

Every production bug should create:

- regression test
- bug entry in `bugs.md`
- root cause note
- fix note

If no regression test is added, document why.

## Done Means Tested

No feature is done until:

- core logic has unit tests
- main workflow has integration or E2E coverage
- permissions are tested
- error states are tested
- relevant docs are updated
