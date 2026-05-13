# Security and Privacy

## Security Principle

MidwayOS handles payments, customer contact information, employee access, inventory, and business operations. Security must be designed in from the start.

## Authentication

Production admin auth must support:

- Unique user accounts.
- Owner and employee roles.
- Server-side permission checks.
- Passwordless or strong password login.
- Session expiration.
- Account disablement.

Do not use a shared static admin password in production.

Current MVP auth:

- Admin users are unique email/password accounts.
- Passwords must be stored as PBKDF2 hashes in production.
- Sessions are signed server-side and expire.
- Disabled users cannot log in or keep using an existing session.
- Owner/employee roles are enforced by protected API routes and feature flags.

## Authorization

Every protected API route must check:

- Authenticated user.
- User role.
- Permission for the specific action.

Sensitive actions:

- Refunds.
- Price changes.
- Square configuration.
- Staff permissions.
- AI high-risk actions.
- Customer data export.
- Accounting sync.
- Chart-of-accounts mappings.

## Payments

- Use Square Web Payments SDK for card collection.
- The browser should only receive public Square app/location data.
- Backend creates/verifies payments.
- Store Square payment/order IDs.
- Do not store raw card data.
- Confirm booking only after payment succeeds.

## Secrets

Never commit:

- Square access tokens.
- Supabase service role keys.
- OpenAI API keys.
- QuickBooks/Intuit OAuth tokens.
- Webhook signing secrets.
- Slack tokens.
- SMS provider tokens.

Use deployment secrets for platform-level infrastructure keys. Use encrypted provider connection storage or secret references for tenant/location provider credentials.

## One-Click OAuth

Provider setup should use OAuth wherever the provider supports it.

Rules:

- Owner connects providers through clear "Connect" buttons.
- Tokens are encrypted at rest.
- Scopes are minimized.
- Connection state is visible.
- Reconnect and disconnect are simple.
- Token refresh failures create owner-facing alerts.
- API keys are not part of the normal owner setup flow.

## Customer Data

Customer PII may include:

- Name.
- Email.
- Phone.
- Booking dates.
- Payment references.
- Vehicle/RV notes.

Rules:

- Store only what is needed.
- Limit employee access to what they need.
- Audit owner/admin access where appropriate.
- Do not expose customer PII to public pages.

## AI Safety

AI must:

- Use typed tools.
- Respect roles.
- Require approval for medium/high-risk actions.
- Record audit logs.
- Avoid exposing sensitive data unnecessarily.

AI must not:

- Receive unrestricted database credentials.
- Receive Square access tokens.
- Execute refunds or price changes without owner approval.
- Push accounting entries without owner/accountant approval.
- Send customer messages without permission.

## MCP Safety

- Treat MCP as a privileged integration surface.
- Require authorization for remote MCP access.
- Scope tokens by role and capability.
- Validate every MCP tool input server-side.
- Audit every MCP tool call.
- Never expose secrets through MCP resources.
- Avoid raw database, Square, or QuickBooks passthrough tools.
- Require approval for medium/high-risk MCP tools.

## Accounting Safety

- Start with export/review mode before live accounting writes.
- Treat QuickBooks sync as high-risk.
- Store external accounting IDs.
- Make sync idempotent.
- Keep a full audit trail.
- Do not silently change historical synced records.
- Let an accountant approve the chart-of-accounts mapping.

## Webhooks

Webhook routes must:

- Verify signatures.
- Store event IDs.
- Be idempotent.
- Avoid leaking raw payloads in public logs.

## Audit Log

Audit these events:

- Login/logout where practical.
- Booking create/cancel/refund.
- Payment confirmation.
- RV site block/unblock.
- Price/hour/content changes.
- Inventory count changes.
- Staff permission changes.
- AI command/action lifecycle.
