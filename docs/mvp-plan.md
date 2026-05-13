# MVP Plan

## MVP Goal

Launch MidwayOS for Midway with the smallest version that proves the operating loop:

**Customer finds Midway -> books an RV site -> pays through Square -> owner sees the exception-first dashboard -> system stays regression-proof.**

The MVP must be beautiful enough publicly, simple enough operationally, and clean enough technically that future phases do not require a rewrite.

## MVP Doctrine

**Automate the normal. Surface the exceptions. Keep the owner out of the weeds.**

## MVP Non-Negotiables

- Provider adapters from the start.
- One-click OAuth connection model from the start where supported.
- Feature flags from the start.
- Tenant-aware data model from the start.
- Regression test harness from the start.
- Draft/preview/publish for frontend editing.
- Audit logs for admin, provider, AI/MCP, and booking actions.
- No raw Square, QuickBooks, or database access from AI/MCP.

## MVP Build Scope

### 1. Foundation

Build:

- tenant/location skeleton
- feature flag evaluator
- provider adapter interfaces
- OAuth connection model
- auth/roles/permissions skeleton
- audit log
- test harness
- fixtures
- CI scripts or documented commands

Do not build:

- self-serve SaaS billing
- multi-tenant platform admin polish
- deep provider marketplace

### 2. Public Website

Build:

- dynamic section renderer
- `midway_farmhouse` theme skin
- public section config
- hero
- services
- RV booking CTA
- location/hours/contact
- Instagram embed with fallback
- local SEO metadata
- mobile-first responsive design
- visual regression baseline

Do not build:

- drag-and-drop page builder
- many theme skins
- separate SEO landing pages
- ecommerce storefront

### 3. Frontend Editing

Build:

- draft frontend config
- preview
- publish
- rollback
- basic tenant editor for text, photos, section visibility/order, theme skin
- AI/MCP-ready editing service boundaries

Do not build:

- arbitrary CSS editor
- complex block/page builder
- public theme marketplace

### 4. RV Booking

Build:

- 14 RV sites
- site amenities
- property map data model
- availability engine
- date selection
- booking quote
- booking hold
- customer details
- booking confirmation state
- admin booking list/map/calendar basics

Do not build:

- complex seasonal pricing
- monthly stays
- advanced discounts
- automated SMS reminders

### 5. Payments

Build:

- `PaymentProvider` interface
- `SquarePaymentProvider`
- Square OAuth/connection model where possible
- embedded checkout
- payment success/failure handling
- webhook verification/normalization/idempotency
- full upfront payment
- refund model skeleton, owner-only

Do not build:

- Stripe adapter
- partial deposits
- complex gift cards/loyalty

### 6. Dashboard

Build:

- mobile-first owner dashboard
- today summary
- RV occupancy
- arrivals/departures
- open alerts
- notification center
- low-stock placeholder/summary if Square data is available
- website content controls
- feature flag-aware navigation

Do not build:

- every possible report
- full Square replacement dashboard
- advanced employee scheduling

### 7. Accounting MVP-Later Boundary

Build only the safe foundation:

- accounting data model skeleton
- export-only provider interface
- accounting exception model
- no live QuickBooks writes

Do not build in first launch:

- live QuickBooks sync
- chart-of-accounts mapping UI
- automated journal entries

### 8. MCP and AI MVP-Later Boundary

Build:

- service boundaries so MCP/AI can call safe tools later
- audit-ready action model
- draft/proposal model

Optional first MVP if time allows:

- read-only MCP tools for dashboard, RV availability, frontend config

Do not build in first launch:

- high-risk MCP actions
- AI auto-actions
- customer-facing AI

### 9. Notifications

Build:

- notification model
- dashboard notification center
- customer booking confirmation email
- owner/staff new booking notification
- optional Slack admin alerts
- provider failure notification
- audit logging for sent/failed notifications

Do not build in first launch:

- SMS automation
- customer chat widget
- AI-sent customer replies
- bulk customer messaging

## MVP Feature Flags

Required on:

- `core.tenant_config`
- `core.roles`
- `core.audit_log`
- `core.provider_adapters`
- `core.oauth_connections`
- `core.feature_flags`
- `public.dynamic_sections`
- `public.theme_skins`
- `booking.rv.enabled`
- `booking.property_map`
- `booking.holds`
- `payments.enabled`
- `payments.provider.square`
- `messaging.email`

Required off or preview:

- `accounting.provider.quickbooks.live_sync`
- `mcp.high_risk_tools`
- `ai.auto_actions`
- `messaging.sms`
- `inventory.barcode_scan`
- `public.seo.landing_pages`
- `domains.custom_domains`

## MVP Regression Gates

The MVP cannot ship unless these pass:

- public site loads on mobile and desktop
- configured sections render in order
- disabled sections do not render
- RV site cannot be double-booked
- expired hold releases availability
- booking cannot confirm before payment succeeds
- Square webhook retries are idempotent
- provider tokens are not exposed to frontend
- employee cannot access owner-only actions
- owner can approve high-risk action skeleton
- audit log records booking/payment/admin actions
- booking confirmation email is queued/sent in provider test mode
- admin notification is created for new booking
- Slack failure does not break booking confirmation
- public site works if Square is temporarily unavailable
- visual regression baseline exists for public site and RV map

## MVP Subagent Plan

### Foundation Agent

Owns:

- tenant/location skeleton
- feature flags
- provider interfaces
- audit log

Deliverables:

- core schemas
- service skeletons
- tests for feature flag evaluation

### Testing Agent

Owns:

- Vitest/Playwright setup
- fixtures
- CI test commands
- critical regression shell

Deliverables:

- unit/integration/E2E smoke tests
- visual baseline workflow

### Frontend Platform Agent

Owns:

- section renderer
- theme skin
- preview/publish/rollback config model
- public site layout

Deliverables:

- beautiful Midway public site
- frontend config tests
- visual baselines

### Booking Agent

Owns:

- RV site model
- availability
- holds
- quote
- booking lifecycle

Deliverables:

- booking domain tests
- no-double-booking tests

### Payment Agent

Owns:

- payment provider interface
- Square adapter
- checkout
- webhooks

Deliverables:

- provider contract tests
- webhook idempotency tests

### Dashboard Agent

Owns:

- owner dashboard
- feature-aware navigation
- RV/admin views
- content editing UI

Deliverables:

- dashboard E2E smoke tests
- role visibility tests

### Security Agent

Owns:

- auth
- permissions
- token handling
- provider secrets

Deliverables:

- permission tests
- secret exposure checks

## MVP Exit Criteria

The MVP is done when:

- a customer can book and pay for an RV site
- owner can see/manage that booking on mobile
- public site looks polished and local
- site content can be safely edited through draft/preview/publish
- Square is connected through provider boundaries
- tests protect the critical business path
- docs match implementation
