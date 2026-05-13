# Architecture Decision Records

Use this file to record important decisions so future agents understand why the system is shaped this way.

## ADR-001: Product Name Is MidwayOS

- Date: May 8, 2026
- Status: accepted

Decision:

Use **MidwayOS** as the working name for the website plus operations platform.

Reason:

The project is larger than a brochure website. It includes bookings, Square, dashboard workflows, AI, inventory, sales, and closed-loop learning.

## ADR-002: Custom RV Booking Layer

- Date: May 8, 2026
- Status: proposed

Decision:

MidwayOS should own RV site availability, map state, holds, booking rules, and booking records. Square should process payment and store order/payment data.

Reason:

RV sites are nightly physical reservations with map positions and amenities. Square Bookings is appointment/service-oriented and may not map cleanly to campground-style reservations.

## ADR-003: Square as Commerce Source of Truth

- Date: May 8, 2026
- Status: proposed

Decision:

Use Square as the source of truth for payments, POS sales, catalog, and inventory where practical.

Reason:

The store already wants Square. Duplicating POS/inventory logic would increase maintenance and create conflicting records.

## ADR-004: AI Must Use Typed Tools

- Date: May 8, 2026
- Status: proposed

Decision:

AI may query and change data only through explicit, permissioned tools.

Reason:

MidwayOS handles payments, customer data, pricing, inventory, and staff access. AI actions need safety boundaries and audit trails.

## ADR-005: Accounting Automation Is Exception-First

- Date: May 8, 2026
- Status: proposed

Decision:

MidwayOS should reduce owner bookkeeping work by preparing accounting-ready summaries and surfacing exceptions, not by making the owner manage raw transactions.

Reason:

Convenience store owners need fewer admin tasks. Square payouts, fees, refunds, taxes, RV booking revenue, and bank deposits can be noisy. An exception-first accounting layer lets the owner or accountant approve what matters while routine data flows automatically.

## ADR-006: QuickBooks Online Is Likely First Accounting Target

- Date: May 8, 2026
- Status: proposed

Decision:

Use QuickBooks Online as the likely first accounting integration target while keeping the accounting provider layer abstract.

Reason:

QuickBooks Online is common for small businesses and has an official Accounting API. Keeping the provider boundary abstract lets MidwayOS support export-only mode or another accounting platform later.

## ADR-007: MCP Is the Agent-Facing Operating Layer

- Date: May 8, 2026
- Status: proposed

Decision:

MidwayOS should expose a full MCP server for approved agents, with tools, resources, prompts, permissions, approvals, and audit logs.

Reason:

The system is meant to be operated through agents over time. MCP gives agents a standard interface while keeping them away from raw databases, Square, QuickBooks, and privileged internal services. This future-proofs MidwayOS across different AI clients and models.

## ADR-008: Providers Are Swappable Adapters

- Date: May 8, 2026
- Status: accepted

Decision:

Payment, accounting, messaging, and other external services must be implemented behind provider adapters with normalized MidwayOS business objects.

Reason:

MidwayOS should not become structurally dependent on Square, QuickBooks, Twilio, or any single vendor. Provider adapters make it possible to switch vendors later without rewriting booking, dashboard, accounting, AI, or MCP logic.

## ADR-009: Testing Harness Comes Before Feature Depth

- Date: May 8, 2026
- Status: accepted

Decision:

Phase 0.5 must establish testing, fixtures, provider contract tests, E2E smoke tests, and critical regression checks before deep feature implementation.

Reason:

Bookings, payments, accounting, inventory, and AI actions create high business risk. Regression-proof development is cheaper than repairing trust after a double booking, bad refund, broken checkout, or incorrect accounting sync.

## ADR-010: Features Are Platform-Managed Flags

- Date: May 8, 2026
- Status: accepted

Decision:

MidwayOS should manage modules through structured feature flags across platform, tenant, location, role, and environment scopes.

Reason:

Different stores need different features. Feature flags let the platform stay simple per business while supporting RV booking, fuel, accounting, MCP, inventory, SMS, and other modules without code forks.

## ADR-011: Frontends Are Section-Based Skins, Not Forks

- Date: May 8, 2026
- Status: accepted

Decision:

Public websites should be rendered from curated sections, variants, theme skins, business profiles, content, and feature flags.

Reason:

The frontend needs to look incredible and feel custom, but custom forks create maintenance debt. Section-based skins keep visual quality high while preserving one shared platform.
