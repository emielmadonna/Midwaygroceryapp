# Accounting Automation

## Goal

MidwayOS should remove accounting and operational admin from the convenience store owner as much as possible.

The owner should not spend time stitching together Square sales, RV bookings, payouts, taxes, fees, refunds, inventory changes, and deposits. MidwayOS should collect the operational truth, prepare clean accounting summaries, flag exceptions, and route approved records into QuickBooks Online or another accounting platform.

## Core Principle

Do not make the owner do bookkeeping inside MidwayOS.

MidwayOS should:

- Collect data from Square and Midway-owned workflows.
- Normalize it into accounting-ready records.
- Match payouts to sales.
- Separate sales, taxes, tips, refunds, fees, discounts, RV revenue, fuel/store categories, and adjustments.
- Push or prepare entries for the accounting system.
- Flag exceptions for review.
- Learn from how exceptions are resolved.

## Recommended Accounting Strategy

Start with QuickBooks Online as the likely accounting target, but keep the accounting layer abstract enough to support another system later.

Why QuickBooks Online is a strong candidate:

- It is common for small businesses.
- It has an official Accounting API.
- It supports customers, vendors, accounts, payments, bills, refunds, reports, and items through API entities.
- It already has Square integration options, but MidwayOS can add operational context from RV bookings, fuel, inventory, and AI workflows.

Official references:

- QuickBooks Online Accounting API: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api
- QuickBooks Online API request basics: https://developers.intuit.com/app/developer/qbo/docs/get-started/create-a-request
- Square Payouts API: https://developer.squareup.com/docs/payouts-api/overview
- QuickBooks + Square integration overview: https://quickbooks.intuit.com/online/integrations/square/

## Accounting Data Sources

### Square

Use Square for:

- POS sales.
- Online RV payments.
- Refunds.
- Payment fees.
- Orders.
- Payouts.
- Catalog/product categories.
- Inventory movement where available.

Square payout timing matters. Square notes that payout windows may not match the exact business day, which means MidwayOS needs a clearing/reconciliation model rather than assuming daily sales equal bank deposits.

### MidwayOS

Use MidwayOS for:

- RV booking records.
- Booking dates and site revenue.
- Add-ons.
- Holds/cancellations.
- Site occupancy.
- AI-approved adjustments.
- Operational notes explaining unusual events.

### Accounting System

Use QuickBooks/accounting software for:

- Final books.
- Chart of accounts.
- Profit and loss.
- General ledger.
- Vendor bills.
- Tax/accountant workflows.
- Reconciliation records.

## Owner-Offload Workflow

The ideal daily workflow:

1. Square sales and payouts sync automatically.
2. RV booking payments are matched to Square payments/orders.
3. MidwayOS categorizes revenue into configured buckets.
4. Fees, taxes, refunds, and discounts are separated.
5. MidwayOS prepares an accounting batch.
6. AI checks for anomalies.
7. Owner only sees exceptions:
   - unmatched payout
   - tax mismatch
   - uncategorized item
   - refund needing explanation
   - unusual sales drop/spike
   - missing vendor bill
8. Approved records sync to QuickBooks.
9. Corrections are remembered for next time.

## Accounting Categories

Initial categories to support:

- Store sales
- Fuel sales
- Coffee/espresso
- Bait and tackle
- Ice
- Firewood
- RV site revenue
- RV add-ons
- Sales tax payable
- Square processing fees
- Refunds
- Discounts
- Tips if applicable
- Cash sales if tracked
- Vendor purchases
- Inventory adjustments

The owner/accountant should approve the final chart-of-accounts mapping.

## Accounting Layer Features

MVP-later features:

- Daily Square sales summary.
- Square payout matching.
- RV revenue summary.
- Sales tax summary.
- Refund summary.
- Fee summary.
- Accounting exception queue.
- Export CSV for accountant if API sync is not ready.

Advanced:

- QuickBooks Online OAuth connection.
- Chart-of-accounts mapping.
- Push daily sales receipts, journal entries, or summarized batches.
- Vendor bill drafts.
- Cash over/short tracking.
- Bank deposit matching assistance.
- Monthly accountant packet.
- AI anomaly detection.
- AI bookkeeping assistant with approval workflow.

## QuickBooks Integration Model

Possible approaches:

1. Native Square-to-QuickBooks integration plus MidwayOS reporting
   - Fastest.
   - Less custom code.
   - MidwayOS mainly provides exception detection and operational context.

2. MidwayOS-controlled QuickBooks sync
   - More control.
   - Can map RV/site revenue and operational categories precisely.
   - Requires careful accounting design and accountant approval.

3. Hybrid
   - Use Square/QuickBooks built-in sync for POS sales.
   - Use MidwayOS to sync RV booking summaries, adjustments, and exceptions.
   - Likely best starting path.

## AI Accounting Assistant

AI should help with:

- "Why does this payout not match yesterday's sales?"
- "Show uncategorized Square items."
- "Summarize RV revenue for April."
- "What should I send my accountant this month?"
- "Which refunds need notes?"
- "Did Square fees look normal this week?"

AI should not:

- File taxes.
- Give final accounting advice.
- Change chart of accounts without approval.
- Push journal entries without owner/accountant approval.
- Hide exceptions.

## Exception Queue

Every accounting issue should become a task, not a mystery.

Exception types:

- Unmatched payout.
- Missing Square order.
- Payment without booking.
- Booking without payment.
- Uncategorized product.
- Tax mismatch.
- Refund mismatch.
- Duplicate transaction.
- Vendor bill missing.
- Large variance from normal pattern.

Each exception should have:

- Severity.
- Source.
- Suggested fix.
- Required approval.
- Audit trail.

## Data Model Additions

Suggested tables:

- `accounting_connections`
- `accounting_account_mappings`
- `accounting_batches`
- `accounting_entries`
- `accounting_exceptions`
- `payout_reconciliations`
- `tax_summaries`
- `accounting_sync_events`

## Safety

- Treat accounting sync as high-risk.
- Require owner/accountant approval before enabling live sync.
- Keep export-only mode available.
- Store every pushed entry and external ID.
- Make sync idempotent.
- Never silently change historical accounting records.

