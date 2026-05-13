# MCP Agent Interface

## Purpose

MidwayOS should expose a full MCP interface so approved agents can safely inspect and operate the business.

The MCP layer is the agent-facing operating surface for MidwayOS. It should let an owner, employee, or trusted agent ask questions and perform approved actions without giving the agent unrestricted access to the database, Square, QuickBooks, or internal services.

Core principle:

**Automate the normal. Surface the exceptions. Keep the owner out of the weeds.**

## Why MCP

Model Context Protocol provides a standard way for agent clients to discover and call:

- Tools: controlled actions and queries.
- Resources: readable business context.
- Prompts: reusable workflows and guided operating procedures.

That maps cleanly to MidwayOS:

- Tools perform governed business actions.
- Resources expose current state and reports.
- Prompts guide agents through approved workflows.

Official references:

- MCP architecture: https://modelcontextprotocol.io/docs/learn/architecture
- MCP specification: https://modelcontextprotocol.io/specification/2024-11-05/index
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

## Design Principle

The MCP server should sit above the internal API/service layer.

Agents should call:

```text
Agent -> MCP server -> MidwayOS services -> database/Square/QuickBooks
```

Agents should not call:

```text
Agent -> database
Agent -> Square directly
Agent -> QuickBooks directly
```

## Tool Categories

### Read-Only Tools

Safe for most authenticated roles:

- `get_today_dashboard`
- `get_store_status`
- `search_bookings`
- `get_rv_availability`
- `get_rv_site_details`
- `get_low_stock_items`
- `get_sales_summary`
- `get_accounting_exceptions`
- `get_square_sync_status`
- `get_audit_log_summary`
- `get_frontend_config`
- `get_notifications`
- `get_conversation_threads`

### Draft Tools

Create proposals, not final changes:

- `draft_booking`
- `draft_site_block`
- `draft_reorder`
- `draft_accounting_batch`
- `draft_website_announcement`
- `create_frontend_draft`
- `update_frontend_section`
- `reorder_frontend_sections`
- `set_theme_skin`
- `draft_square_product_change`
- `draft_staff_task`
- `draft_customer_reply`
- `draft_staff_alert`

### Action Tools

Require role checks and, for medium/high-risk actions, explicit approval:

- `create_booking_hold`
- `confirm_manual_booking`
- `block_rv_site`
- `update_store_hours`
- `update_fuel_price`
- `update_inventory_count`
- `acknowledge_low_stock_alert`
- `resolve_accounting_exception`
- `approve_accounting_batch`
- `validate_frontend_draft`
- `preview_frontend_draft`
- `mark_notification_read`
- `resolve_notification`
- `send_staff_alert`

### High-Risk Tools

Owner/accountant approval required:

- `issue_refund`
- `change_square_price`
- `sync_accounting_batch_to_quickbooks`
- `change_chart_of_accounts_mapping`
- `add_staff_user`
- `change_staff_permissions`
- `send_bulk_customer_message`
- `send_customer_message`
- `publish_frontend_draft`
- `rollback_frontend_publish`

## Resources

Expose readable context through resources such as:

- `midway://dashboard/today`
- `midway://rv/sites`
- `midway://rv/availability/{dateRange}`
- `midway://inventory/low-stock`
- `midway://sales/summary/{dateRange}`
- `midway://accounting/exceptions`
- `midway://content/public-site`
- `midway://frontend/config`
- `midway://frontend/draft`
- `midway://frontend/published`
- `midway://audit/recent`
- `midway://docs/operating-principles`

Resources should be filtered by role and should not expose secrets.

## Prompts

Useful prompt templates:

- `daily_owner_brief`
- `explain_accounting_exception`
- `prepare_reorder_review`
- `review_rv_occupancy`
- `investigate_sales_drop`
- `prepare_weekend_readiness`
- `create_shift_handoff`
- `update_public_announcement`
- `edit_frontend_section`
- `prepare_seasonal_frontend_update`

Prompts should encode the MidwayOS operating style:

- be concise
- show exceptions first
- ask for approval before risky action
- cite the tool/resource data used
- never invent operational facts

## Permissions

Every MCP call must resolve:

- actor identity
- role
- permission
- risk level
- approval state
- audit requirement

Roles:

- owner
- manager
- employee
- accountant
- readonly_agent
- automation_agent

Permission model:

- Read tools can be broadly available.
- Draft tools can be available to managers/owners.
- Action tools require explicit permission.
- High-risk tools require owner/accountant approval depending the domain.

## Approval Flow

Medium/high-risk MCP actions should follow this pattern:

1. Agent proposes action.
2. MidwayOS records proposed payload.
3. Owner/accountant approves, rejects, or edits.
4. MCP action executes through internal service.
5. Result and external IDs are stored.
6. Audit log records the full chain.

## Security

MCP must be treated as a privileged integration surface.

Requirements:

- Use transport-level authorization for remote MCP servers.
- Support scoped access tokens.
- Keep tool descriptions unambiguous.
- Use strict schemas for every tool input.
- Validate all tool input server-side.
- Rate-limit sensitive actions.
- Store all tool calls in audit logs.
- Never expose raw secrets through resources.
- Avoid STDIO access to production systems unless the runtime is tightly controlled.

## Versioning

Version the MCP surface separately from internal APIs:

- `midwayos.mcp.v1`

Breaking changes should create a new tool name or versioned namespace.

## Future-Proofing

Keep provider boundaries clean:

- Square can change.
- QuickBooks can change.
- SMS provider can change.
- AI model/client can change.
- Public site framework can change.

The MCP server should expose business capabilities, not vendor-specific implementation details.

Good:

- `get_low_stock_items`
- `draft_accounting_batch`
- `block_rv_site`

Avoid:

- `run_square_batch_retrieve_inventory_counts`
- `post_quickbooks_journal_entry_raw`

## Initial MCP MVP

First MCP release should include:

- Today's dashboard resource.
- RV availability resource/tool.
- Booking search.
- Low-stock query.
- Accounting exceptions query.
- Daily owner brief prompt.
- Draft announcement prompt/tool.
- Audit logging for every MCP call.
