# Square Setup

MidwayOS uses Square Web Payments SDK for RV checkout. The browser renders Square's secure card form and sends a single-use token to the backend; the backend creates the Square payment, confirms the booking, and keeps Square payment/refund IDs for reconciliation.

## Tenant Provider Connection

Square settings are tenant/location provider configuration, not hard-coded deployment variables. Normal setup should be OAuth/connect-button driven and stored in `provider_connections`.

| Field | Required | Storage | Notes |
| --- | --- | --- |
| access token | Yes | encrypted credentials or secret ref | Server-only; never sent to browser. |
| application ID | Yes | public config | Public Square app ID for Web Payments SDK. |
| location ID | Yes | public config and external location ID | The Square location that receives RV payments. |
| environment | Yes | public config | `sandbox` or `production`. |
| webhook signature key | Yes for webhooks | encrypted credentials or secret ref | Verifies Square webhook signatures. |
| RV variation IDs | Yes for catalog mapping | public config | 30A/50A nightly SKU variation IDs. |
| connection status/scopes | Yes | provider connection record | Drives health, reconnect, and feature availability. |

## Square App

1. Create or select the Square developer app that belongs to Midway.
2. Use sandbox credentials for local testing and production credentials only for live checkout.
3. Confirm the app has access to the same merchant account used by the store POS.
4. Store tokens in the provider connection secret store. Do not expose access tokens to browser code.

## Admin Connect API

The admin API exposes the provider connection skeleton before the owner-facing UI is finalized:

```text
GET /api/admin/providers
POST /api/admin/providers/square/oauth/start
POST /api/admin/providers/square/oauth/callback
```

`GET /api/admin/providers` returns normalized provider status with public config, scope, account/location IDs, and redacted credential metadata. It never returns Square access tokens, refresh tokens, webhook secrets, Slack webhooks, or email provider webhooks.

`POST /api/admin/providers/square/oauth/start` creates or updates a `provider_connections` business object with `status=connecting` and returns the Square authorization URL when the platform OAuth app is configured. If the platform OAuth app credentials are absent, the route returns a safe placeholder response with `mode=placeholder`, `authorizationUrl=null`, and the missing platform credential names instead of pretending the tenant is connected.

`POST /api/admin/providers/square/oauth/callback` validates the OAuth state, exchanges the code for Square seller tokens when platform credentials exist, and stores those values through the connection credential interface (`secret_ref` or `encrypted_credentials`). In the current local/runtime skeleton, `encrypted_credentials` can hold token-shaped values until a real KMS-backed secret store is connected.

Platform OAuth app credentials are platform provider configuration, not tenant business setup and not process env. Store them in the platform provider config source that backs `getPlatformProviderConfig`, with public browser-safe values separated from encrypted credentials:

```json
{
  "providerKey": "square",
  "environment": "sandbox",
  "publicConfig": {
    "applicationId": "sandbox-app-id",
    "environment": "sandbox",
    "redirectUri": "https://example.com/admin/providers/square/oauth/callback",
    "scopes": [
      "MERCHANT_PROFILE_READ",
      "PAYMENTS_READ",
      "PAYMENTS_WRITE",
      "ORDERS_READ",
      "ORDERS_WRITE",
      "ITEMS_READ"
    ]
  },
  "encryptedCredentials": {
    "clientSecret": "stored-in-secret-store"
  }
}
```

## Location

Set the provider connection's Square location ID to the live location for that tenant/location. RV Web Payments charges use this location, so a wrong value sends payments and reporting to the wrong location.

Before enabling production checkout, run a sandbox card payment and a live low-dollar test if Square account policy allows it. Confirm the resulting Square payment appears under the expected location.

## Permissions

Grant only the permissions needed by the current integration:

- Payments write access for `POST /v2/payments`.
- Orders read access for follow-up reconciliation and webhook matching.
- Catalog items read access so the app can read Square item variations.
- Inventory read/write access only when inventory sync is enabled.
- Payments read access for payment reconciliation and webhook processing.

The OAuth skeleton requests least-privilege payment/order/catalog scopes by default and allows the platform provider config to override scopes per environment.

## RV SKU Variation IDs

Create Square catalog item variations for each nightly RV rate that should be tracked in Square:

| Midway SKU | Provider config key | Expected use |
| --- | --- | --- |
| `RV-30A-NIGHT` | `rvVariationIds.30A` | 30 amp nightly RV sites. |
| `RV-50A-NIGHT` | `rvVariationIds.50A` | 50 amp nightly RV sites. |

Use the Square catalog **item variation ID**, not the item ID. Current Web Payments charges store the booking code/payment ID for reconciliation; the variation IDs are still required for the RV pricing/catalog mapping and future order-line reconciliation.

## Webhooks

Configure a Square webhook subscription for the API route:

```text
POST /api/square/webhook
```

Subscribe to payment and order events needed for booking reconciliation, including payment created/updated and order updated events. Store the webhook signature key with the tenant/location provider connection so the API can reject unsigned or tampered events.

Webhook processing must stay idempotent. Square may retry events, and multiple events can describe the same order or payment.

The API stores each `event_id` in `square_events`. If Square retries an event that has already been processed, the API returns success without confirming the booking a second time.

## Production Gate

Production checkout is intentionally strict:

- The tenant/location Square provider connection must be `connected`.
- The connection must have an access token, application ID, live location ID, `environment=production`, webhook signature key, and RV variation IDs.
- Supabase/server persistence must be enabled for production.
- Failed Square requests are not converted to local or synthetic payments.
- Local and development environments must use Square sandbox credentials, not synthetic payment shortcuts.
