# Agent Guide

This guide is for any AI agent or developer working on MidwayOS.

## Start Here

Before editing code, read:

1. [README.md](./README.md)
2. [MIDWAY_REBUILD_PLAN.md](./MIDWAY_REBUILD_PLAN.md)
3. [arch.md](./arch.md)
4. [clean-code.md](./clean-code.md)
5. [bugs.md](./bugs.md)

If touching payments, inventory, accounting, customer data, auth, or AI tools, also read:

- [security-privacy.md](./security-privacy.md)
- [api-layer.md](./api-layer.md)
- [accounting-automation.md](./accounting-automation.md)
- [mcp-agent-interface.md](./mcp-agent-interface.md)
- [ai-closed-loop.md](./ai-closed-loop.md)

## Product Mental Model

MidwayOS has two faces:

- Public site: simple, fast, customer-friendly.
- Admin platform: mobile-first operating system for the store.

Do not let internal complexity leak into the public website.

## Development Rules

- Keep changes modular.
- Preserve existing user changes.
- Update docs when architecture changes.
- Prefer clear business names over generic abstractions.
- Treat Square, auth, AI actions, and bookings as high-risk areas.
- Treat accounting sync as high-risk until owner/accountant-approved.
- Treat MCP as the agent-facing operating contract.
- Add audit logs for important state changes.

## Common Workflows

### Adding a Public Site Section

1. Confirm it belongs on the public site.
2. Add content schema/config if staff should edit it.
3. Use theme tokens.
4. Keep mobile layout first.
5. Update SEO if the section affects search.

### Adding a Dashboard Feature

1. Define owner vs employee permissions.
2. Add API route/service.
3. Add audit logging.
4. Add UI with clear empty/error states.
5. Add docs for new behavior.

### Adding a Square Feature

1. Keep all Square calls in Square service layer.
2. Use idempotency keys.
3. Store Square IDs locally.
4. Add webhook handling if Square can update the state later.
5. Update [api-layer.md](./api-layer.md) and [security-privacy.md](./security-privacy.md).

### Adding an AI Tool

1. Define risk tier.
2. Define exact input schema.
3. Define permission checks.
4. Define confirmation requirement.
5. Write audit log.
6. Update [ai-closed-loop.md](./ai-closed-loop.md).

### Adding an MCP Tool

1. Decide whether it is read-only, draft, action, or high-risk.
2. Define a strict input/output schema.
3. Route through internal services, not raw vendors or SQL.
4. Add permission checks.
5. Add approval flow if needed.
6. Add audit logging.
7. Update [mcp-agent-interface.md](./mcp-agent-interface.md).

### Adding an Accounting Feature

1. Start in export/review mode unless live sync is explicitly approved.
2. Keep provider-specific code behind an accounting service boundary.
3. Store external IDs for synced records.
4. Make sync idempotent.
5. Add exception handling.
6. Update [accounting-automation.md](./accounting-automation.md).

## Current Known Context

The existing repo is a prototype with:

- Vite frontend.
- Admin page.
- Supabase client.
- Supabase schema for fuel/hours/inventory notes.
- Square handler concept.
- Slack/OpenAI server concept.

Treat current code as a prototype, not finished architecture.

## Do Not

- Do not hard-code credentials.
- Do not expose service-role keys.
- Do not bypass Square payment verification.
- Do not confirm bookings before payment succeeds.
- Do not allow double-booking.
- Do not give AI unrestricted database or Square access.
- Do not push accounting entries without owner/accountant approval.
- Do not remove unrelated user changes.

## Definition of Done

A task is done when:

- Feature works.
- Mobile layout is usable.
- Errors are handled.
- Permissions are enforced.
- Relevant docs are updated.
- Critical paths are tested or manually verified.
- Known follow-up risks are logged in [bugs.md](./bugs.md).
