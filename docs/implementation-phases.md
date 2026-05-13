# Implementation Phases and Subagents

## Operating Principle

**Automate the normal. Surface the exceptions. Keep the owner out of the weeds.**

Every phase should protect that principle.

## Agent Work Rules

Each phase can be split across focused subagents. Subagents should have clear ownership, disjoint write areas, and explicit deliverables.

Rules:

- One subagent owns one bounded domain.
- Do not let two subagents edit the same files without coordination.
- Every subagent updates relevant docs.
- Every subagent adds or updates tests.
- Every subagent logs known risks in `bugs.md`.
- Integration happens only after tests pass locally.

## Phase 0: Foundation and Guardrails

Goal:

- Establish the codebase skeleton, provider boundaries, test harness, and CI.

Subagents:

- Architecture Agent
  - Owns feature/module layout.
  - Implements provider interface skeletons.
  - Implements feature flag evaluation skeleton.
  - Implements host/domain-aware tenant resolution skeleton.
  - Updates `arch.md` and `provider-adapters.md`.

- Testing Agent
  - Owns Vitest/Playwright/axe setup.
  - Creates fixtures and critical regression suite shell.
  - Updates `testing-strategy.md`.

- Feature Flag Agent
  - Owns feature matrix implementation.
  - Adds platform/tenant/location/role flag fixtures.
  - Updates `feature-flags.md`.

- Security Agent
  - Owns auth/roles/permissions skeleton.
  - Defines secret/env handling.
  - Updates `security-privacy.md`.

Exit criteria:

- Test command exists.
- E2E smoke test exists.
- Provider adapter interfaces exist.
- Feature flag matrix and evaluator exist.
- Tenant/domain resolution skeleton exists.
- Role/permission model exists.
- CI plan documented or implemented.

## Phase 1: Public Site and Design System

Goal:

- Build the simple, beautiful public site and theme system.

Subagents:

- Public UI Agent
  - Owns homepage sections and responsive layout.
  - Uses theme tokens.

- Frontend Platform Agent
  - Owns section config, theme skin loading, preview/publish model.
  - Updates `frontend-platform.md`.

- SEO/GEO Agent
  - Owns metadata, schema, sitemap, local SEO content.
  - Updates `seo-geo.md`.

- Content Config Agent
  - Owns editable content model for hours, contact, announcements, services.

Tests:

- homepage renders
- configured sections render in order
- disabled sections do not render
- mobile layout smoke
- SEO metadata present
- call/text/directions links valid
- Instagram fallback appears

Exit criteria:

- Public site works without provider connectivity.
- Visual regression baseline captured.

## Phase 2: RV Booking Core

Goal:

- Implement booking engine independent of payment provider.

Subagents:

- Booking Domain Agent
  - Owns date logic, overlap prevention, quote calculation, holds.

- RV Map Agent
  - Owns site map data, availability rendering, site details.

- Booking API Agent
  - Owns booking endpoints and validation.

Tests:

- overlap prevention
- adjacent bookings allowed when valid
- hold expiration
- quote calculation
- unavailable site cannot be booked

Exit criteria:

- Booking holds and availability work without payment provider.

## Phase 3: Payments and Checkout

Goal:

- Add provider-neutral payment flow with Square as first adapter.

Subagents:

- Payment Adapter Agent
  - Owns `PaymentProvider` interface and Square adapter.

- Checkout UI Agent
  - Owns embedded checkout UI and failure states.

- Webhook Agent
  - Owns provider webhook verification, normalization, idempotency.

Tests:

- checkout session created
- payment success confirms booking
- payment failure leaves booking unconfirmed
- webhook retry is idempotent
- provider unavailable shows safe error

Exit criteria:

- Sandbox payment can confirm booking.
- Provider can be swapped behind interface.

## Phase 4: Admin Dashboard MVP

Goal:

- Give owner/employees a mobile-first operating dashboard.

Subagents:

- Dashboard UI Agent
  - Owns Today, RV, Bookings views.

- Admin API Agent
  - Owns protected dashboard endpoints.

- Permissions Agent
  - Owns owner/employee role enforcement.

Tests:

- owner sees full dashboard
- employee sees limited dashboard
- employee cannot refund/sync/accounting
- owner can block site
- audit log records admin action

Exit criteria:

- Owner can manage bookings and site state from phone.

## Phase 5: Inventory and Square Operations

Goal:

- Surface useful inventory/sales exceptions without pretending inventory is perfect.

Subagents:

- Inventory Agent
  - Owns inventory cache, low-stock alerts, count adjustments.

- Square Catalog Agent
  - Owns catalog/inventory sync through provider service.

- Sales Summary Agent
  - Owns sales dashboard summaries.

Tests:

- low-stock alerts fire
- catalog sync maps items
- inventory updates do not overwrite newer data
- sales summary handles missing provider data

Exit criteria:

- Owner sees low-stock and sales summaries.

## Phase 6: Accounting Automation

Goal:

- Build exception-first accounting layer.

Subagents:

- Accounting Domain Agent
  - Owns batches, entries, exceptions, payout reconciliation.

- QuickBooks Adapter Agent
  - Owns OAuth prototype and provider interface.
  - Starts in sandbox/export-only mode.

- Accountant Export Agent
  - Owns CSV/PDF accountant packet.

Tests:

- accounting batch totals match fixture events
- payout variance creates exception
- export-only provider works
- QuickBooks token expiry handled
- high-risk sync requires approval

Exit criteria:

- Owner can review exceptions and export accountant packet.

## Phase 7: MCP and AI Operations

Goal:

- Let agents safely operate MidwayOS through MCP.

Subagents:

- MCP Server Agent
  - Owns tools/resources/prompts and schemas.

- AI Tools Agent
  - Owns AI command parsing and proposal flow.

- Audit/Approval Agent
  - Owns action lifecycle and approval checks.

Tests:

- read-only MCP tools respect role
- draft tools do not mutate state
- high-risk tools require approval
- every MCP tool call is audited
- AI cannot bypass permissions

Exit criteria:

- Agent can produce daily owner brief and propose safe actions.

## Phase 8: Communication

Goal:

- Add email/SMS confirmations and staff alerts through provider adapters.

Subagents:

- Messaging Adapter Agent
  - Owns email/Slack/SMS provider interfaces.

- Notification Workflow Agent
  - Owns dashboard notifications, booking confirmations, admin alerts, and reminders.

Tests:

- confirmation email queued
- new booking creates admin notification
- optional Slack alert sends when enabled
- SMS disabled by config does not fail booking
- provider failure creates alert
- bulk messages require approval

Exit criteria:

- Booking confirmations are reliable.

## Phase 9: Reusable Platform

Goal:

- Make MidwayOS adaptable for future businesses.

Subagents:

- Theming Agent
  - Owns theme tokens and brand config.

- Tenant Config Agent
  - Owns business config and feature flags.

- Migration Agent
  - Owns provider/data export and migration docs.

Tests:

- theme switch does not break layout
- feature flags hide/show modules safely
- export includes core business data

Exit criteria:

- Another similar business could be configured without rewriting core code.
