# Notifications and Conversations

## Purpose

MidwayOS needs a unified notification and conversation layer.

Notifications should keep owners and employees aware of exceptions without creating noise. Conversations should let customers contact the business simply and let staff or AI respond safely through approved channels.

Core principle:

**Automate the normal. Surface the exceptions. Keep the owner out of the weeds.**

## Notification Categories

### Admin/Staff Alerts

Examples:

- new RV booking
- payment failed
- booking canceled
- refund requested
- arrival today
- departure today
- site blocked/unblocked
- low stock
- accounting exception
- provider disconnected
- domain/DNS issue
- AI action needs approval
- suspicious POS/inventory pattern later

### Customer Notifications

Examples:

- booking confirmation
- payment receipt link
- booking reminder
- cancellation confirmation
- refund confirmation
- check-in instructions
- site rules

### Platform/Admin Notifications

Examples:

- provider OAuth token expired
- webhook failures
- SSL/domain issue
- failed scheduled job
- feature flag changed
- high-risk action approved/executed

## Channels

Initial:

- in-app dashboard alerts
- email
- Slack webhook/app for admin/staff alerts

Later:

- SMS
- Teams
- push notifications
- voice/call summaries
- customer chat widget

## Recommended MVP Channels

MVP should support:

- dashboard notification center
- admin email notifications
- optional Slack admin alerts
- customer email confirmation

SMS should be designed but can ship later.

## Notification Data Model

### notifications

- id
- tenant_id
- location_id
- type
- severity: info, success, warning, critical
- audience: owner, manager, employee, customer, platform
- title
- body
- entity_type
- entity_id
- status: unread, read, archived, resolved
- created_at
- read_at
- resolved_at

### notification_deliveries

- id
- notification_id
- channel: dashboard, email, slack, sms, webhook
- provider
- recipient
- status: pending, sent, delivered, failed, skipped
- provider_message_id
- error_message
- sent_at
- delivered_at
- created_at

### conversation_threads

- id
- tenant_id
- customer_id
- source: website, sms, email, slack, phone_note, admin
- status: open, pending, resolved, archived
- subject
- last_message_at
- assigned_to
- created_at

### conversation_messages

- id
- thread_id
- sender_type: customer, staff, ai, system
- sender_id
- channel
- body
- status
- provider_message_id
- created_at

## Notification Preferences

Each tenant/location/user should configure:

- enabled channels
- quiet hours
- severity thresholds
- booking alert recipients
- accounting alert recipients
- inventory alert recipients
- provider failure recipients

Example:

```json
{
  "booking.new": ["dashboard", "email", "slack"],
  "booking.payment_failed": ["dashboard", "email", "slack"],
  "inventory.low_stock": ["dashboard"],
  "accounting.exception": ["dashboard", "email"],
  "provider.disconnected": ["dashboard", "email", "slack"]
}
```

## Slack Admin Alerts

Slack is useful for quick staff/admin updates.

Slack should be implemented as a notification provider:

- `SlackNotificationProvider`

Events that should go to Slack if enabled:

- new booking
- payment failed
- arrival/departure summary
- low stock summary
- accounting exceptions
- AI action approval needed
- provider disconnected

Slack should not be required for the system to function.

## Talking to the Site

There are three different meanings of "talking to the site":

### 1. Customers Contact the Business

MVP:

- call button
- text link if phone supports it
- simple contact prompt

Later:

- website chat/contact widget
- SMS conversation inbox
- AI-drafted responses
- staff approval before AI sends customer messages

### 2. Owner/Staff Talk to MidwayOS

MVP-later:

- AI command box in dashboard
- MCP tools for agents

Examples:

- "What sites are open this weekend?"
- "Block site 4 tomorrow."
- "Show me booking issues."
- "Draft a winter homepage update."

### 3. Agent Talks to MidwayOS

Through MCP:

- read dashboard
- query bookings
- draft changes
- propose messages
- never bypass permissions

## Booking Notification Flow

New booking:

1. Customer completes payment.
2. Booking becomes confirmed.
3. Customer receives confirmation email.
4. Owner/staff dashboard gets notification.
5. Slack alert is sent if enabled.
6. Arrival/departure summaries update.

Payment failed:

1. Booking remains unconfirmed.
2. Hold eventually expires.
3. Customer sees retry message.
4. Admin gets warning only if failure needs attention.

Cancellation/refund:

1. Booking status updates.
2. Payment/refund provider event is processed.
3. Customer gets confirmation.
4. Admin gets alert.
5. Audit log records action.

## AI and Notification Safety

AI can:

- summarize notifications
- draft responses
- suggest actions
- group noisy alerts
- explain why an alert matters

AI should not:

- send customer messages without approval
- send bulk messages without approval
- hide critical alerts
- mark accounting/payment exceptions resolved without permission

## Notification Noise Rules

Avoid alert fatigue:

- Group low-priority alerts.
- Send immediate alerts only for critical issues.
- Daily digest for normal summaries.
- Route role-specific alerts.
- Let tenant configure channels.

Examples:

- One daily low-stock digest instead of 20 item alerts.
- Immediate alert for payment provider disconnected.
- Immediate alert for double-booking risk.
- Daily arrival/departure summary in the morning.

## MCP Notification Tools

Read-only:

- `get_notifications`
- `get_notification_preferences`
- `get_conversation_threads`
- `get_booking_notification_status`

Draft:

- `draft_customer_reply`
- `draft_staff_alert`
- `draft_notification_preference_change`

Action:

- `mark_notification_read`
- `resolve_notification`
- `send_staff_alert`

High-risk:

- `send_customer_message`
- `send_bulk_customer_message`
- `change_notification_preferences`

## MVP Notification Scope

Build:

- notification table/model
- dashboard notification center
- customer booking confirmation email
- owner/staff new booking notification
- optional Slack notification provider
- provider failure notification
- audit logging

Skip:

- SMS automation
- customer chat widget
- bulk messaging
- AI-sent customer replies
- push notifications

