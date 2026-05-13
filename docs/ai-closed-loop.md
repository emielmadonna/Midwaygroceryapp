# AI Closed Loop

## Goal

The AI layer should help MidwayOS become more useful as the business uses it.

It should not be a chatbot bolted onto the side. It should be an operating assistant that can query data, propose actions, execute approved tasks, learn from outcomes, and keep a clear record of what happened.

## Closed-Loop Cycle

1. Observe
   - Sales
   - Payouts
   - Inventory
   - Bookings
   - Cancellations
   - Stockouts
   - Accounting exceptions
   - Weather/seasonal patterns
   - Staff actions
   - Owner corrections

2. Understand
   - Summarize what changed.
   - Detect patterns.
   - Compare current state to historical behavior.
   - Identify exceptions.

3. Recommend
   - Low-stock reorder drafts.
   - RV pricing or availability notes.
   - Staffing reminders.
   - Website announcement suggestions.
   - Seasonal product suggestions.

4. Act
   - Execute approved actions through typed tools.
   - Update Square, bookings, content, or alerts only within permissions.

5. Learn
   - Store accepted/rejected recommendations.
   - Store corrections.
   - Compare recommendations to outcomes.
   - Improve future suggestions.

## AI Channels

Initial:

- Admin dashboard command box.

Later:

- Slack.
- SMS.
- Voice/call summaries.

## Risk Tiers

### Low Risk

May execute without extra approval if user is authenticated:

- Answer questions.
- Summarize sales.
- Summarize bookings.
- Draft reorder list.
- Draft accounting summaries.
- Create internal notes.

### Medium Risk

Requires confirmation:

- Update hours.
- Update public announcements.
- Block RV site dates.
- Change RV site details.
- Update inventory count.
- Add product draft.

### High Risk

Requires owner approval:

- Refund payment.
- Change Square pricing.
- Push accounting entries.
- Change chart-of-accounts mappings.
- Delete/deactivate products.
- Place vendor order.
- Change payment settings.
- Add/remove staff access.
- Send bulk customer messages.

## Tool Design

AI should call typed tools such as:

- `get_today_dashboard()`
- `search_bookings(date_range, status)`
- `create_booking_hold(site_id, start_date, end_date)`
- `block_rv_site(site_id, start_date, end_date, reason)`
- `update_store_hours(day, open_time, close_time)`
- `get_low_stock_items()`
- `draft_vendor_order(items)`
- `sync_square_inventory()`
- `create_square_product_draft(product)`
- `get_accounting_exceptions()`
- `draft_accounting_batch(date_range)`
- `explain_payout_variance(payout_id)`

AI should not:

- Run arbitrary SQL.
- Call Square APIs directly.
- Use service-role database keys.
- Execute destructive actions without approval.

## Memory

Use memory for business facts and learned preferences:

- Seasonal rush periods.
- Owner preferences.
- Common customer questions.
- Products that often sell out.
- Vendor reorder cadence.
- RV sites customers prefer.
- Staff workflow notes.

Memory should include:

- Source.
- Confidence.
- Last confirmed date.
- Whether it came from owner, employee, customer, or observed data.

## Audit Requirements

Every AI command should store:

- Raw input.
- Interpreted intent.
- Data read.
- Proposed action.
- Risk level.
- Approval result.
- Executed action.
- Final result.
- Error if any.

## Learning Examples

- If firewood sells out every holiday weekend, AI should recommend ordering earlier before the next comparable weekend.
- If site 4 receives more cancellations because of size limits, AI should suggest clearer public copy.
- If coffee sales spike during snow travel weekends, AI should suggest staffing and inventory reminders.
- If customers repeatedly text the same question, AI should suggest adding that answer to the site FAQ.
