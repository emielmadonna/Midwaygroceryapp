# Provider Adapters

## Purpose

MidwayOS must be easy to switch away from Square, QuickBooks, SMS providers, email providers, map providers, or AI clients later.

The app should own the business language:

- booking
- payment
- refund
- payout
- inventory item
- accounting batch
- accounting entry
- customer message

Provider adapters translate that language into vendor APIs.

Core rule:

**MidwayOS speaks business objects. Providers speak vendor APIs.**

## One-Click OAuth

Provider setup should feel like connecting an app, not configuring enterprise software.

Owner experience:

1. Open Settings.
2. Tap "Connect Square" or "Connect QuickBooks".
3. Complete OAuth consent.
4. Return to MidwayOS.
5. See connected status, scopes, account/location, last sync, and health.

Requirements:

- OAuth where the provider supports it.
- No owner-facing API key copying for normal setup.
- Clear reconnect flow.
- Clear disconnect flow.
- Visible sync status.
- Visible permission/scopes summary.
- Audit log for connect, reconnect, disconnect, sync, and failures.
- Encrypted token storage.
- Tenant/provider setup is stored as `provider_connections` business objects, not as raw environment ownership.
- Environment variables may identify the platform OAuth app, but tenant access tokens, webhook URLs, external account IDs, and location IDs belong on provider connection records.

Provider connection states:

- not_connected
- connecting
- connected
- degraded
- expired
- revoked
- error

Current admin plumbing:

- `GET /api/admin/providers` lists normalized provider status and redacts credentials.
- `POST /api/admin/providers/square/oauth/start` starts Square OAuth or returns a safe placeholder when the platform OAuth app is not configured.
- `POST /api/admin/providers/square/oauth/callback` completes the Square OAuth skeleton and stores tokens through `secret_ref`/`encrypted_credentials`.

Messaging provider movement:

- Email and Slack delivery should read provider config from the connection record when available.
- Messaging webhooks must be configured through provider connections; process env webhook shortcuts are not a tenant setup path.

## Adapter Interfaces

### PaymentProvider

```ts
interface PaymentProvider {
  providerKey: string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  getPayment(providerPaymentId: string): Promise<NormalizedPayment>;
  refundPayment(input: RefundPaymentInput): Promise<NormalizedRefund>;
  verifyWebhook(input: WebhookVerificationInput): Promise<boolean>;
  normalizeWebhook(input: WebhookInput): Promise<NormalizedProviderEvent[]>;
}
```

### AccountingProvider

```ts
interface AccountingProvider {
  providerKey: string;
  getConnectionStatus(): Promise<ProviderConnectionStatus>;
  getAccounts(): Promise<NormalizedAccountingAccount[]>;
  syncBatch(input: AccountingBatch): Promise<AccountingSyncResult>;
  exportBatch(input: AccountingBatch): Promise<AccountingExportResult>;
  verifyWebhook?(input: WebhookVerificationInput): Promise<boolean>;
  normalizeWebhook?(input: WebhookInput): Promise<NormalizedProviderEvent[]>;
}
```

### MessagingProvider

```ts
interface MessagingProvider {
  providerKey: string;
  sendSms(input: SmsMessage): Promise<MessageResult>;
  sendEmail(input: EmailMessage): Promise<MessageResult>;
  getDeliveryStatus(providerMessageId: string): Promise<MessageStatus>;
}
```

### IdentityProvider

```ts
interface IdentityProvider {
  providerKey: string;
  startOAuth(input: OAuthStartInput): Promise<OAuthRedirect>;
  completeOAuth(input: OAuthCallbackInput): Promise<ProviderConnection>;
  refreshToken(connectionId: string): Promise<ProviderConnection>;
  disconnect(connectionId: string): Promise<void>;
}
```

## Initial Providers

Payment:

- `SquarePaymentProvider`
- later: `StripePaymentProvider`
- later: `ManualPaymentProvider`

Accounting:

- `ExportOnlyAccountingProvider`
- `QuickBooksOnlineAccountingProvider`
- later: `XeroAccountingProvider`
- later: `WaveAccountingProvider`

Messaging:

- `EmailProvider`
- `SlackNotificationProvider`
- later: `TwilioMessagingProvider`
- later: another business SMS provider

Social/content:

- `InstagramFeedProvider` for public media via the Instagram Graph API
- Google Business/Profile provider where supported

## Instagram Feed

The public Instagram section can read recent media server-side from Meta's Instagram Graph API. The browser never receives the access token; it only receives normalized post data in `/api/public/bootstrap`:

- `id`
- `title`
- `caption`
- `image`
- `mediaUrl`
- `thumbnailUrl`
- `permalink`
- `mediaType`
- `timestamp`
- `username`

Configuration can come from environment variables for the single-client deployment:

```text
INSTAGRAM_USER_ID=<instagram professional account id>
INSTAGRAM_ACCESS_TOKEN=<graph api access token>
INSTAGRAM_GRAPH_API_VERSION=v24.0
INSTAGRAM_FEED_LIMIT=6
```

Or from the `provider_connections` row for `provider_key = 'instagram'`:

- `public_config.instagramUserId`
- `public_config.apiVersion`
- `public_config.feedLimit`
- `encrypted_credentials.accessToken`

Manual Instagram post URLs remain as a fallback when the API feed is not configured or the Meta request fails.

## Normalized Statuses

Payment statuses:

- pending
- authorized
- paid
- failed
- canceled
- refunded
- partially_refunded
- disputed

Accounting batch statuses:

- draft
- ready_for_review
- approved
- exported
- synced
- failed

Connection statuses:

- not_connected
- connected
- degraded
- expired
- revoked
- error

## Data Rules

Store local records separately from provider payloads.

Example:

```text
payments
- id
- provider
- provider_payment_id
- booking_id
- amount_cents
- status
- created_at

provider_events
- id
- provider
- provider_event_id
- normalized_event_type
- raw_payload
- processed_at
- status
```

Provider-specific payloads are useful for debugging, but business logic should use normalized fields.

## Webhook Pipeline

All provider webhooks should follow the same flow:

1. Receive webhook.
2. Verify signature.
3. Store raw event.
4. Normalize event.
5. Process idempotently.
6. Update local business records.
7. Audit result.

Normalized events:

- `payment.succeeded`
- `payment.failed`
- `refund.created`
- `payout.paid`
- `inventory.updated`
- `accounting_batch.synced`
- `connection.revoked`

## Switching Providers

Provider switches should be operationally safe.

Before switching:

- Export current provider IDs.
- Freeze in-flight checkouts.
- Verify no pending refunds.
- Verify accounting batches are exported/synced.
- Run test transaction in new provider.
- Keep old provider read-only for historical lookup.

Never rewrite historical provider IDs.

## Testing Requirements

Every provider adapter needs contract tests:

- creates normalized records
- maps statuses correctly
- handles webhook retries
- rejects invalid webhook signatures
- stores external IDs
- handles expired/revoked OAuth tokens
- fails safely without corrupting business records
