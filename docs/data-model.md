# Data Model

This document defines the main entities for MidwayOS. Names are conceptual and can be adapted during implementation.

## Core Tables

### users

- id
- email
- phone
- display_name
- role_id
- status
- created_at
- updated_at

### roles

- id
- name: owner, manager, employee
- permissions

### site_settings

- id
- business_name
- public_brand_name
- address
- phone
- sms_phone
- email
- instagram_handle
- google_maps_url
- logo_url
- timezone
- square_location_id
- created_at
- updated_at

### tenants

- id
- name
- status
- business_profile
- default_theme
- created_at
- updated_at

### locations

- id
- tenant_id
- name
- address
- phone
- timezone
- status
- created_at
- updated_at

### feature_flags

- id
- scope_type: platform, tenant, location, role, environment
- scope_id
- flag_key
- flag_value
- rollout_state: disabled, preview, enabled, locked
- updated_by
- updated_at

### frontend_configs

- id
- tenant_id
- location_id
- theme_key
- business_profile
- sections
- draft_config
- published_config
- updated_by
- published_at
- updated_at

### tenant_domains

- id
- tenant_id
- domain
- normalized_domain
- type: platform_subdomain, custom_apex, custom_www, preview
- status: pending_dns, verifying, active, failed, disabled
- is_primary
- verification_token
- dns_target
- ssl_status
- redirect_to_domain_id
- last_checked_at
- verified_at
- created_by
- created_at
- updated_at

### notifications

- id
- tenant_id
- location_id
- type
- severity
- audience
- title
- body
- entity_type
- entity_id
- status
- created_at
- read_at
- resolved_at

### notification_deliveries

- id
- notification_id
- channel
- provider
- recipient
- status
- provider_message_id
- error_message
- sent_at
- delivered_at
- created_at

### conversation_threads

- id
- tenant_id
- customer_id
- source
- status
- subject
- last_message_at
- assigned_to
- created_at

### conversation_messages

- id
- thread_id
- sender_type
- sender_id
- channel
- body
- status
- provider_message_id
- created_at

### store_hours

- id
- day_of_week
- open_time
- close_time
- is_closed
- note
- updated_at

### site_announcements

- id
- title
- body
- starts_at
- ends_at
- is_active
- created_by
- created_at
- updated_at

## RV Booking Tables

### rv_sites

- id
- site_number
- display_name
- status: active, inactive, maintenance
- nightly_price_cents
- max_rv_length_feet
- map_x
- map_y
- map_width
- map_height
- sort_order
- short_description
- customer_notes
- admin_notes
- created_at
- updated_at

### rv_site_amenities

- id
- rv_site_id
- amenity_key
- amenity_label
- amenity_value

Amenity examples:

- electric
- water
- sewer
- firewood_nearby
- pull_through
- back_in
- shade
- picnic_table
- max_length

### rv_site_photos

- id
- rv_site_id
- media_asset_id
- sort_order
- alt_text

### rv_bookings

- id
- booking_code
- rv_site_id
- customer_id
- start_date
- end_date
- nights
- guests
- vehicles
- subtotal_cents
- tax_cents
- fee_cents
- total_cents
- currency
- status: draft, hold, paid, confirmed, canceled, refunded, expired
- square_order_id
- square_payment_id
- source: website, admin, phone, ai
- created_by
- created_at
- updated_at

### rv_booking_holds

- id
- rv_site_id
- start_date
- end_date
- customer_session_id
- expires_at
- converted_booking_id
- status: active, converted, expired, released
- created_at

### rv_booking_addons

- id
- booking_id
- catalog_object_id
- name
- quantity
- unit_price_cents
- total_cents

## Customer Tables

### customers

- id
- square_customer_id
- first_name
- last_name
- email
- phone
- notes
- created_at
- updated_at

## Square Tables

### square_sync_state

- id
- sync_type
- last_synced_at
- cursor
- status
- error_message

### square_events

- id
- event_id
- event_type
- payload
- processed_at
- status
- error_message
- created_at

### inventory_cache

- id
- square_catalog_object_id
- square_variation_id
- location_id
- name
- category
- quantity
- price_cents
- low_stock_threshold
- updated_at

### low_stock_alerts

- id
- inventory_cache_id
- quantity
- threshold
- status: open, acknowledged, ordered, dismissed
- created_at
- resolved_at

## Accounting Tables

### accounting_connections

- id
- provider: quickbooks_online, export_only, other
- status
- external_company_id
- connected_by
- connected_at
- last_synced_at

### accounting_account_mappings

- id
- provider
- internal_category
- external_account_id
- external_account_name
- approved_by
- updated_at

### accounting_batches

- id
- batch_date
- source: square, midwayos, hybrid
- status: draft, ready_for_review, approved, synced, failed
- gross_sales_cents
- tax_cents
- fees_cents
- refunds_cents
- net_payout_cents
- notes
- approved_by
- synced_at
- created_at

### accounting_entries

- id
- accounting_batch_id
- entry_type
- category
- amount_cents
- external_entry_id
- source_entity_type
- source_entity_id
- status
- created_at

### accounting_exceptions

- id
- exception_type
- severity
- source
- source_entity_type
- source_entity_id
- message
- suggested_fix
- status: open, acknowledged, resolved, dismissed
- resolved_by
- resolved_at
- created_at

### payout_reconciliations

- id
- square_payout_id
- payout_date
- expected_net_cents
- actual_net_cents
- variance_cents
- status
- created_at
- resolved_at

## AI and Audit Tables

### ai_commands

- id
- user_id
- channel: dashboard, slack, sms, system
- raw_input
- interpreted_intent
- status
- created_at

### ai_actions

- id
- ai_command_id
- action_type
- risk_level: low, medium, high
- proposed_payload
- approved_by
- executed_payload
- result
- status: proposed, approved, rejected, executed, failed
- created_at
- updated_at

### ai_memories

- id
- memory_type
- key
- content
- confidence
- source_event_id
- created_at
- updated_at

### audit_log

- id
- actor_type: user, ai, system, square
- actor_id
- action
- entity_type
- entity_id
- before_data
- after_data
- created_at

## Data Rules

- Store money as integer cents.
- Store dates in explicit local booking dates for RV stays.
- Store timestamps with timezone.
- Never trust client-calculated totals.
- Keep Square IDs on local records.
- Use audit logs for all admin, AI, payment, and booking changes.
- Do not delete important business records; soft-delete or archive.
