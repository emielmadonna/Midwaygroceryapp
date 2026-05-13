# Architecture

## Architecture Principle

MidwayOS should be modular, boring where possible, and easy for future agents to reason about.

The public website should be fast and simple. The operational platform should be secure and explicit. Square should own payment and POS commerce data where possible. MidwayOS should own RV site availability, property maps, booking rules, AI audit trails, and website content.

## System Layers

### Public Web Layer

Responsibilities:

- Render the public Midway single-page website.
- Show public business data: hours, location, phone, services, Instagram, RV booking entry.
- Render RV availability and booking UI.
- Collect customer booking details.
- Render Square Web Payments SDK payment form.

Should not:

- Expose secrets.
- Make privileged Square calls directly.
- Trust client-side booking totals without backend validation.

### Admin Web Layer

Responsibilities:

- Owner and employee login.
- Mobile-first dashboard.
- RV map/calendar management.
- Booking actions.
- Website content editing.
- Inventory and sales visibility.
- AI command interface.

Should not:

- Bypass permission checks.
- Perform destructive actions without audit logs.
- Let AI actions run without the required approval tier.

### Backend API Layer

Responsibilities:

- Validate all booking, payment, inventory, and AI actions.
- Own business rules.
- Create Square orders/payments.
- Receive Square webhooks.
- Maintain booking holds.
- Write audit logs.
- Enforce role permissions.

### Database Layer

Responsibilities:

- Store Midway-owned data.
- Store cached Square data for speed.
- Store AI action history and learning context.
- Store audit logs.

Suggested service: Supabase/Postgres.

### Square Integration Layer

Responsibilities:

- Catalog sync.
- Inventory sync.
- Payment creation.
- Order creation.
- Payment/refund status.
- Webhook processing.

Square should remain the source of truth for:

- Payments.
- Square orders.
- POS sales.
- Catalog where practical.
- Inventory counts where practical.

Square must be implemented as a provider adapter, not hard-coded throughout the app.

### Accounting Automation Layer

Responsibilities:

- Normalize Square payments, orders, refunds, fees, taxes, and payouts.
- Match RV bookings to Square payments.
- Prepare accounting-ready summaries.
- Route approved data to QuickBooks Online or another accounting platform.
- Maintain an exception queue.
- Learn from owner/accountant corrections.

The accounting layer should reduce admin burden by making the owner review exceptions, not raw transaction noise.

Accounting sync should start in export/review mode before any live write integration.

QuickBooks must be implemented as an accounting provider adapter. Export-only mode should always remain available.

### Provider Adapter Layer

Responsibilities:

- Keep payment, accounting, messaging, social, and map providers swappable.
- Provide one-click OAuth connection flows where supported.
- Normalize provider events into MidwayOS events.
- Hide provider-specific payloads behind stable business interfaces.
- Store provider connection status, scopes, external IDs, and audit logs.

Provider calls should flow through business services:

```text
bookingService -> paymentService -> PaymentProvider
accountingService -> AccountingProvider
notificationService -> MessagingProvider
```

The rest of the app should not import Square, QuickBooks, or SMS SDKs directly.

### Feature Flag Layer

Responsibilities:

- Enable/disable modules by platform, tenant, location, role, and environment.
- Hide disabled features from UI, APIs, MCP tools, reports, and navigation.
- Support preview rollout before production enablement.
- Audit all flag changes.

Feature flags should be structured, not scattered booleans.

Examples:

- `booking.rv.enabled`
- `accounting.provider.quickbooks.live_sync`
- `mcp.action_tools`
- `public.section.instagram`
- `inventory.expiration_tracking`

### Frontend Platform Layer

Responsibilities:

- Render dynamic public frontends from section config, theme skins, content, and feature flags.
- Support multiple business profiles without code forks.
- Keep visual quality high through curated sections and variants.
- Provide preview/publish and rollback for frontend changes.

The frontend should feel bespoke. The code should stay shared.

### AI Operations Layer

Responsibilities:

- Answer business questions.
- Propose actions.
- Execute approved low/medium/high-risk actions through typed tools.
- Record commands, decisions, results, and corrections.

AI must never receive unrestricted database or Square access.

### MCP Agent Interface Layer

Responsibilities:

- Expose MidwayOS capabilities to approved agents through MCP tools, resources, and prompts.
- Keep agents behind role checks, approvals, and audit logs.
- Provide a stable future-proof interface above Square, QuickBooks, booking, inventory, and content services.

The MCP server should expose business capabilities, not raw vendor APIs.

Example:

- Good: `get_low_stock_items`
- Good: `draft_accounting_batch`
- Good: `block_rv_site`
- Avoid: raw database access
- Avoid: raw Square/QuickBooks API passthrough

## Module Boundaries

Recommended future source layout:

```text
src/
  app/
    public/
    admin/
  components/
    public/
    admin/
    shared/
  features/
    booking/
    rv-map/
    providers/
    payments/
    feature-flags/
    frontend-platform/
    inventory/
    fuel/
    content/
    ai/
    accounting/
    mcp/
    auth/
    seo/
  lib/
    db/
    validation/
    permissions/
    dates/
    money/
    audit/
  styles/
    tokens.css
    base.css
    public.css
    admin.css
server/
  routes/
  services/
  jobs/
  webhooks/
  tools/
docs/
```

Each feature should contain its own domain logic, UI, tests, and API client where reasonable.

## Booking Architecture

MidwayOS should own RV booking.

Reasons:

- RV stays are nightly reservations, not typical service appointments.
- Each RV site has physical map location and amenities.
- Availability needs property-map visualization.
- Booking rules may include holds, blocked dates, seasonal rates, add-ons, and site-specific constraints.

Square should process payment and store the payment/order record.

Booking flow:

1. Customer selects dates.
2. Backend computes available sites.
3. Customer selects site.
4. Backend creates a short-lived booking hold.
5. Backend creates Square order/payment intent data.
6. Customer pays through Square Web Payments SDK.
7. Backend verifies payment.
8. Booking becomes paid/confirmed.
9. Confirmation is sent.
10. Audit log records the full sequence.

## Integration Events

Important events:

- `booking.hold_created`
- `booking.hold_expired`
- `booking.payment_started`
- `booking.payment_succeeded`
- `booking.payment_failed`
- `booking.confirmed`
- `booking.canceled`
- `booking.refunded`
- `square.payment.updated`
- `square.inventory.updated`
- `square.catalog.updated`
- `ai.action_proposed`
- `ai.action_approved`
- `ai.action_executed`
- `ai.action_rejected`

## Reusability for Other Businesses

To make MidwayOS reusable later:

- Keep brand settings in configuration, not hard-coded UI.
- Keep public sections composable.
- Keep "bookable assets" generic underneath RV-specific labels.
- Use theme tokens.
- Keep Square location configurable.
- Keep map data external.
- Avoid naming generic modules after Midway unless they are truly business-specific.
