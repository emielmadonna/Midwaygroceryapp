# Feature Flags and Module Matrix

## Purpose

Feature flags let MidwayOS stay simple for each business while remaining powerful as a platform.

Every tenant should see only the features they use. Platform admins should be able to enable, disable, configure, and stage features without code changes.

## Principles

- Features are off unless enabled by tenant profile or platform admin.
- Disabled features should disappear from UI, APIs, MCP tools, reports, and navigation.
- Feature flags must be tenant-aware.
- Feature flags must be role-aware when needed.
- Features can have configuration, not just `true` or `false`.
- Risky features can be enabled in preview mode before production use.

## Feature Flag Levels

### Platform Level

Controls whether a feature exists globally.

Example:

- `platform.accounting.enabled`
- `platform.mcp.enabled`

### Tenant Level

Controls whether a business can use a feature.

Example:

- `tenant.rv_booking.enabled`
- `tenant.inventory.low_stock_alerts.enabled`

### Location Level

Controls whether a location/store uses a feature.

Example:

- `location.fuel.enabled`
- `location.rv_booking.enabled`

### Role Level

Controls whether a role can see/use a feature.

Example:

- `role.employee.can_view_sales`
- `role.manager.can_block_rv_sites`

### Environment Level

Controls rollout by environment.

Example:

- `env.production.quickbooks_live_sync.enabled`
- `env.staging.sms_confirmations.enabled`

## Flag Types

Boolean:

- on/off

Enum:

- `accounting.mode = export_only | review | live_sync`

Numeric:

- `booking.hold_minutes = 15`

List:

- `public.enabled_sections = ["hero", "services", "rv_map", "instagram"]`

Object:

- theme, provider, booking rules, dashboard layout

## Feature Matrix

### Core Platform

| Feature | Flag | Default | Notes |
|---|---|---:|---|
| Tenant config | `core.tenant_config` | on | Required for scale |
| Role permissions | `core.roles` | on | Required |
| Audit log | `core.audit_log` | on | Required |
| Provider adapters | `core.provider_adapters` | on | Required |
| One-click OAuth | `core.oauth_connections` | on | Required where provider supports OAuth |
| Feature flags | `core.feature_flags` | on | Required |

### Public Website

| Feature | Flag | Default | Notes |
|---|---|---:|---|
| Dynamic sections | `public.dynamic_sections` | on | Required for multi-frontend |
| Theme skins | `public.theme_skins` | on | Required |
| Hero | `public.section.hero` | on | Required |
| Services | `public.section.services` | on | Required |
| Location/map | `public.section.location` | on | Required |
| Hours/contact | `public.section.hours_contact` | on | Required |
| Instagram embed | `public.section.instagram` | tenant | Optional |
| Gallery | `public.section.gallery` | off | Optional |
| Events | `public.section.events` | off | Optional |
| Local SEO pages | `public.seo.landing_pages` | off | Later |

### RV and Booking

| Feature | Flag | Default | Notes |
|---|---|---:|---|
| RV booking | `booking.rv.enabled` | tenant | Midway on |
| Property map | `booking.property_map` | tenant | Midway on |
| Booking holds | `booking.holds` | on | Required if checkout enabled |
| Seasonal pricing | `booking.seasonal_pricing` | off | Later |
| Add-ons | `booking.addons` | tenant | Firewood, etc. |
| Manual admin booking | `booking.manual_admin` | on | Useful for phone bookings |
| SMS reminders | `booking.sms_reminders` | off | Later |
| Email confirmations | `booking.email_confirmations` | on | MVP/later depending provider |

### Payments

| Feature | Flag | Default | Notes |
|---|---|---:|---|
| Online payments | `payments.enabled` | tenant | Midway on |
| Square provider | `payments.provider.square` | tenant | First implementation |
| Stripe provider | `payments.provider.stripe` | off | Later |
| Manual payment | `payments.provider.manual` | off | Later |
| Refunds | `payments.refunds` | owner | High-risk |
| Deposits | `payments.deposits` | off | Midway wants full upfront |

### Inventory and Store Ops

| Feature | Flag | Default | Notes |
|---|---|---:|---|
| Inventory cache | `inventory.cache` | tenant | Useful |
| Low-stock alerts | `inventory.low_stock_alerts` | tenant | Useful |
| Receiving workflow | `inventory.receiving` | off | Later |
| Barcode scan | `inventory.barcode_scan` | off | Later |
| Expiration tracking | `inventory.expiration_tracking` | off | High-value for grocery |
| Vendor reorder drafts | `inventory.reorder_drafts` | off | Later |
| Theft/shrink exceptions | `inventory.shrink_exceptions` | off | Later |

### Fuel

| Feature | Flag | Default | Notes |
|---|---|---:|---|
| Fuel prices | `fuel.prices` | tenant | Midway on |
| Fuel tank levels | `fuel.tank_levels` | tenant | Useful |
| Fuel reorder alerts | `fuel.reorder_alerts` | off | Later |
| Price sign sync | `fuel.price_sign_sync` | off | Hardware-dependent |

### Accounting

| Feature | Flag | Default | Notes |
|---|---|---:|---|
| Accounting summaries | `accounting.summaries` | tenant | Useful |
| Exception queue | `accounting.exceptions` | tenant | Core principle |
| Export packet | `accounting.export_packet` | tenant | Safe first |
| QuickBooks OAuth | `accounting.provider.quickbooks.oauth` | off | Later |
| QuickBooks live sync | `accounting.provider.quickbooks.live_sync` | off | High-risk |
| Chart mapping | `accounting.chart_mapping` | off | Accountant approval |

### AI and MCP

| Feature | Flag | Default | Notes |
|---|---|---:|---|
| AI command box | `ai.command_box` | tenant | Later MVP |
| AI recommendations | `ai.recommendations` | tenant | Later |
| AI auto-actions | `ai.auto_actions` | off | Risky |
| MCP server | `mcp.server` | tenant | Agent layer |
| MCP read tools | `mcp.read_tools` | tenant | Safe first |
| MCP action tools | `mcp.action_tools` | off | Requires approval workflows |
| MCP high-risk tools | `mcp.high_risk_tools` | off | Owner approval |

### Messaging

| Feature | Flag | Default | Notes |
|---|---|---:|---|
| Email provider | `messaging.email` | tenant | Useful |
| Dashboard notifications | `notifications.dashboard` | on | Core admin alerts |
| Slack admin alerts | `notifications.slack` | tenant | Optional |
| Booking confirmations | `notifications.booking_confirmations` | tenant | Email first |
| SMS provider | `messaging.sms` | off | Later |
| Staff alerts | `messaging.staff_alerts` | off | Later |
| Bulk customer messages | `messaging.bulk_customer` | off | High-risk |

### Domains

| Feature | Flag | Default | Notes |
|---|---|---:|---|
| Domain management | `domains.enabled` | off | Later platform feature |
| Custom domains | `domains.custom_domains` | off | Later |
| Apex/root domains | `domains.apex_domains` | off | Hosting-dependent |
| WWW redirects | `domains.www_redirect` | off | Later |
| Auto SSL | `domains.auto_ssl` | off | Hosting-dependent |
| Preview domains | `domains.preview_domains` | tenant | Useful for editor previews |

## Platform Admin UI

Platform admin should manage:

- tenant profile
- enabled modules
- feature flags
- frontend sections
- theme skin
- provider connections
- rollout mode
- preview mode
- audit log

Flag changes must be audited:

- who changed it
- old value
- new value
- reason if high-risk
- timestamp

## Preview and Rollout

Rollout states:

- disabled
- preview
- enabled
- locked

Preview mode lets platform admin test a feature before employees/customers see it.

## Feature Flag Evaluation

Every feature check should resolve:

```text
platform flag
tenant flag
location flag
role permission
environment
provider connection health
```

If a required provider is disconnected, the feature should show a clear setup or degraded state.

## Current Implementation

The MVP evaluator lives in `src/lib/feature-flags.js`.

It supports:

- canonical feature keys such as `booking.rv.enabled`, `public.section.instagram`, and `payments.refunds`
- role overrides for owner-only behavior
- environment overrides through `FEATURE_FLAGS_JSON`
- individual environment keys prefixed with `FEATURE_FLAG_`
- legacy public aliases such as `rvBooking`, `instagram`, `manualAdminBooking`, and `refunds`
- API enforcement through `requireFeature(...)`

Example:

```json
{
  "public.section.instagram": true,
  "booking.admin_calendar": false,
  "booking.admin_property_map": false,
  "payments.refunds": false
}
```

The Supabase schema now includes a `feature_flags` table for the future editor/admin UI, but the current runtime reads defaults plus environment overrides.

## Testing

Feature flag tests should cover:

- disabled features hidden from UI
- disabled features blocked from APIs
- disabled features unavailable via MCP
- enabled features appear only for allowed roles
- provider-disconnected degraded states
- preview mode visibility
