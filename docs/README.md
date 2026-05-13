# MidwayOS Documentation

MidwayOS is the working name for the rebuild of Midway's website and operations platform.

The product is intentionally small on the outside and capable on the inside:

- A simple public website for customers.
- A mobile-first backend for owners and employees.
- RV site booking with property-map availability.
- Square-connected payments, inventory, catalog, and sales.
- Accounting automation to reduce owner admin work.
- AI-assisted operations with audit trails and approval rules.
- Modular code and documentation so future agents can safely extend the system.

## Doc Index

- [MIDWAY_REBUILD_PLAN.md](./MIDWAY_REBUILD_PLAN.md): Full planning document and product vision.
- [mvp-plan.md](./mvp-plan.md): Focused first-launch scope, non-negotiables, subagents, and regression gates.
- [product-scope.md](./product-scope.md): What MidwayOS is, who it serves, and what store owners need.
- [arch.md](./arch.md): System architecture, module boundaries, and integration strategy.
- [data-model.md](./data-model.md): Core entities and database model.
- [api-layer.md](./api-layer.md): API design rules and proposed endpoint groups.
- [provider-adapters.md](./provider-adapters.md): Swappable payment/accounting/messaging providers and one-click OAuth.
- [feature-flags.md](./feature-flags.md): Platform, tenant, location, role, and environment feature matrix.
- [frontend-platform.md](./frontend-platform.md): Dynamic frontend skins, section composition, and visual quality rules.
- [domain-management.md](./domain-management.md): Custom domains, DNS verification, SSL, routing, and future domain admin.
- [accounting-automation.md](./accounting-automation.md): QuickBooks/accounting layer, reconciliation, payouts, taxes, and owner offload.
- [mcp-agent-interface.md](./mcp-agent-interface.md): MCP tools, resources, prompts, permissions, and agent-facing operating layer.
- [notifications-conversations.md](./notifications-conversations.md): Admin alerts, Slack/email/SMS, customer conversations, and booking notification flows.
- [ai-closed-loop.md](./ai-closed-loop.md): AI assistant, learning loop, tools, permissions, and audit model.
- [ops-dashboard.md](./ops-dashboard.md): Owner/employee dashboard requirements.
- [ui-system.md](./ui-system.md): Public site and admin UI design system.
- [clean-code.md](./clean-code.md): Coding standards, comments, file layout, and maintainability rules.
- [testing-strategy.md](./testing-strategy.md): Regression-proof test harness, critical suites, and CI expectations.
- [implementation-phases.md](./implementation-phases.md): Phase-by-phase execution plan with subagent ownership.
- [agent-guide.md](./agent-guide.md): How future agents should understand and work in this project.
- [bugs.md](./bugs.md): Known bugs, risks, and issue log.
- [security-privacy.md](./security-privacy.md): Auth, payments, PII, secrets, and safe AI controls.
- [seo-geo.md](./seo-geo.md): Search, local SEO, structured data, and regional content plan.
- [roadmap.md](./roadmap.md): Phase plan and release milestones.
- [decisions.md](./decisions.md): Architecture decision records.

## Current Priority

Build the MVP around the highest-value loop:

1. Customer finds Midway.
2. Customer books an RV site on a map.
3. Customer pays through Square.
4. Owner sees the booking, payment, and site status on mobile.
5. Staff can make simple updates without developer help.
6. Agents can operate through MCP with permissions, approvals, and audit logs.

Everything else should support that loop or wait.
