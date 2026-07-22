# HarborHub MCP

Production-oriented MCP server for [hub.harborwholesale.com](https://hub.harborwholesale.com). It gives AI agents a fast, safe Harbor ordering surface with 106 tools for catalog discovery, cart auditing, order confirmation, replenishment, order workflows, shopping lists, SRP books, account data, and guarded live mutations.

The server was built from live Harbor Hub UI/network reconnaissance, then tuned for agent productivity: compact cart reads, batch validation, per-item failure reasons, batch cart cleanup, setup diagnostics, request timeouts, and explicit mutation permissions.

## Why This Exists

Harbor Hub is powerful, but agents need a different interface than humans clicking through a web app. This MCP turns Harbor workflows into predictable, structured tools so an agent can:

- Audit hundreds of cart lines without pulling huge nested cart payloads.
- Pre-check SKUs before adding them and skip discontinued, unauthorized, out-of-stock, equipment, and fixture items.
- Add or remove many cart lines in one approved operation.
- Browse and search sellable retail catalog items without accidentally mixing in display fixtures or store equipment.
- Work safely: all live mutations are blocked until explicitly enabled for the session and confirmed per call.

## Quick Start

**Claude Code** — one line:

```bash
claude mcp add harborhub -- npx -y harborhub-mcp
```

**Claude Desktop** — add to `claude_desktop_config.json` and restart:

```json
{
  "mcpServers": {
    "harborhub": {
      "command": "npx",
      "args": ["-y", "harborhub-mcp"]
    }
  }
}
```

That's all the setup. The **server** holds your Harbor credentials in its own
environment and signs itself in — no store id to hard-code, and **no password ever
passes through the agent or the conversation.**

> Running from source instead? `git clone … && npm install && npm run build`, then
> point your client's `command`/`args` at `node /abs/path/dist/index.js`.

### First run: sign in (one time)

Easiest — **interactive login, nothing to pre-configure:**

1. **`harbor_login_start`** — returns a local `http://127.0.0.1:<port>/...` URL. Open it
   and enter your Harbor email + password on that page (it's served locally; your
   password goes only to Harbor, never to the assistant).
2. **`harbor_login_wait`** — finishes sign-in and **auto-selects your store**. A refresh
   token is cached, so you won't do this again — `harbor_authenticate` is headless after.

Prefer zero interaction? Set **one** of these in the server's `env` (or a `.env` next to
it — auto-loaded), then just call `harbor_authenticate`:

- **`HARBOR_BEARER_TOKEN`** — a long-lived bearer token, **or**
- **`HARBOR_EMAIL`** + **`HARBOR_PASSWORD`** — server runs the grant + auto-refreshes.

Keep any such config readable only by you (`chmod 600 .env`); never commit it.

> **Agents must never ask the user for their Harbor password or pass a password to
> any tool.** Use `harbor_login_start` (local prompt) or server-held credentials — the
> password never enters the conversation.

> **Note:** tool usage (who, which items, success/error) is recorded for the
> operator running this server. See [Usage Tracking](#usage-tracking).

## Agent Startup Prompt

Paste this into any agent conversation that has HarborHub MCP connected:

```text
You have access to HarborHub MCP tools (harbor_*).
Start by calling harbor_setup_check, then harbor_get_agent_guide.
To sign in: call harbor_authenticate (no arguments). If it returns AUTH_NOT_CONFIGURED, call harbor_login_start, give me the local 127.0.0.1 URL to enter my Harbor email + password, then call harbor_login_wait. NEVER ask me for my password in chat or pass a password to any tool.
If authentication returns multiple availableStores, ask me which one, then call harbor_switch_store with that storeId. If it auto-selected a single store, continue.
For cart audits, prefer harbor_list_cart_lines over harbor_get_cart.
Before adding multiple SKUs, call harbor_validate_items.
If you need to change carts, orders, lists, or pricing, explain the exact change first, get my explicit approval, then call harbor_set_permissions with mutations:"enabled" and pass confirm:true on the mutation call.
```

## Recommended Agent Workflows

### Setup

1. `harbor_setup_check`
2. `harbor_get_agent_guide`
3. `harbor_authenticate` (no arguments — server-held credentials)
4. `harbor_switch_store` if the user wants a different customer/store
5. `harbor_health_check` for a lightweight live check

### Fast Cart Audit

1. `harbor_list_cart_lines`
2. Inspect `LineId`, `ItemNumber`, `Description`, `Category`, `Price`, `Quantity`, `UnitOfMeasure`
3. Use `harbor_remove_multiple_cart_items` only after user approval

Use `harbor_get_cart` only when full nested Harbor cart details are explicitly needed.

### Batch Add To Cart

1. Build candidate SKU list from `harbor_browse_catalog`, `harbor_search_catalog`, order history, or shopping lists
2. `harbor_validate_items`
3. Skip invalid items by reason code
4. Ask the user to approve the exact add operation
5. `harbor_set_permissions { mutations: "enabled" }`
6. `harbor_add_multiple_to_cart { confirm: true, items: [...] }`

Validation result codes include `Valid`, `Discontinued`, `Unauthorized`, `OutOfStock`, `StoreEquipment`, `DisplayFixture`, and `NotFound`.

### Understanding Products & Quantities

A Harbor item is rarely "one thing you buy." Most items can be ordered in several **buying units** — Each, Sales Pack, Case, Carton — and each unit has its own pack size, price, and ordering rules. Ordering "2" means two of whichever unit you chose, so 2 cases of a 6-pack item puts 12 retail pieces on the shelf.

Product reads (`harbor_get_product`, `harbor_search_by_item_number`, `harbor_get_product_info_modal`, `harbor_validate_items`) now surface a `BuyingOptions` breakdown for every item:

| Field | Meaning |
| --- | --- |
| `code` / `name` | UOM code and label — `EA` Each, `SP` Sales Pack, `CS` Case, `CT` Carton |
| `retailUnits` | How many individual retail pieces this unit contains |
| `packageDescription` | Harbor pack string, e.g. `6 32z` (6 units of 32 oz) |
| `unitPrice` | What you pay for one of this unit |
| `pricePerRetailUnit` | Cost per individual piece (unitPrice ÷ retailUnits) |
| `suggestedRetail` / `marginPct` | SRP per piece and margin |
| `minimumOrderQuantity` / `orderMultiples` | Ordering rules for this unit |
| `onDeal` / `regularPrice` / `dealSavings` | Whether the unit is on an active deal, its list price, and the savings. `unitPrice` is the price you actually pay (net of the deal); `pricePerRetailUnit` reflects it, so a deal correctly lowers the cost-per-piece |
| `isDefault` | The item's default buying unit |

Buying-option summaries also flag the **best value per piece** — e.g. when a case is on deal and beats buying singles — so the agent can recommend the cheaper unit.

`harbor_get_buying_options` is a focused tool for this. It returns the full breakdown and, when you pass `unitOfMeasure` + `quantity`, confirms exactly what will be ordered:

```text
harbor_get_buying_options { itemNumber: "3500058", unitOfMeasure: "case", quantity: 2 }
→ resolved: Case [CS]; quantityCheck: 2 × Case = 12 retail pieces (~$58.78)
```

Cart adds (`harbor_add_to_cart`, `harbor_add_multiple_to_cart`) accept either a UOM **code** (`EA`/`SP`/`CS`/`CT`) or a **word** (`each`, `pack`, `case`, `carton`) for `unitOfMeasure`. They:

- resolve the unit against the item's real buying options (rejecting units the item is not sold in, instead of silently coercing),
- validate the quantity against the unit's minimum and order multiples,
- and return `unitOfMeasure`, `unitName`, `orderedRetailUnits`, and `extendedPrice` so the agent can confirm the order back to the user.

### Substitutions

When an item is out of stock, discontinued, or unauthorized, Harbor often carries a substitute on file. Instead of just skipping the item, the agent can offer the alternative:

- `harbor_validate_items` and the add-to-cart tools now include a `substitute` and `availability` on each result, so a blocked item comes back with its suggested replacement.
- `harbor_find_substitute { itemNumber }` returns the substitute's full snapshot — availability, deal status, and buying options — so the agent can propose a ready alternative (or reports `hasSubstitute:false` when none is on file).

### Confirming Orders & Replenishment

- **`harbor_get_order_draft`** — a read-only, itemized, priced summary of the current cart for a human to confirm before checkout: each line with extended price, retail value, and margin; totals (subtotal, retail value, blended margin, deal savings); and an attention list (price changes since add, blocked items, substitution suggestions). Tax, fees, and delivery are determined by Harbor at checkout and are not included.
- **`harbor_get_par_replenishment`** — "top up to par" reorder suggestions sourced from an explicit item list, a shopping list, or the current cart. For each item with a par level on file, it suggests the smallest order quantity that reaches par (honoring minimum order quantity and order multiples) with price and extended cost. Suggestions only — route accepted items through `harbor_add_multiple_to_cart`.

### Previewing Mutations (dryRun)

Every cart mutation (`harbor_add_to_cart`, `harbor_add_multiple_to_cart`, `harbor_update_cart_item`, `harbor_remove_cart_item`, `harbor_remove_multiple_cart_items`, `harbor_clear_cart`, `harbor_checkout_cart`) accepts `dryRun: true`. It runs all validation and returns the **exact request that would be sent** plus its projected impact, **without** changing anything and **without** requiring `confirm`/mutations-enabled. Use it to preview a change before approval, or to reconcile after a timeout instead of blind-retrying.

### Catalog Browsing

Use `harbor_browse_catalog` or `harbor_search_catalog` for retail product discovery. By default, catalog responses are annotated with `ItemType` and filtered toward `RetailProduct` so equipment and fixtures do not pollute agent recommendations.

Use `filters.itemTypes` when you explicitly want:

- `RetailProduct`
- `StoreEquipment`
- `DisplayFixture`

## Authentication

**Design principle: the user's password never travels through the assistant or the
conversation.** Whatever the flow, the password goes straight to Harbor (Auth0) or to
a local-only server — never into an agent tool call. After one sign-in a **refresh
token** is cached, so everything afterwards is headless: no browser, no prompt.

### Option B — interactive login (recommended; nothing to pre-configure)

The agent triggers it; the user types their credentials into a **local** page only.

```text
harbor_login_start     // → returns http://127.0.0.1:<port>/?nonce=...   (agent shows this to the user)
                       //   user opens it, enters Harbor email + password on that LOCAL page
harbor_login_wait      // → completes auth, auto-selects the store, stores a refresh token
```

The form posts straight to a one-time `127.0.0.1` server the MCP runs; the assistant
never sees the password. A refresh token is saved to `~/.harborhub/credentials.json`
(0600), so from then on `harbor_authenticate` just works — no repeat login.

### Option A — operator config (zero per-use interaction)

Set one of these in the server's `env` (or `.env`) once:

- `HARBOR_BEARER_TOKEN` — a long-lived bearer token, or
- `HARBOR_EMAIL` + `HARBOR_PASSWORD` — the server runs the Auth0 password grant itself
  and auto-refreshes.

Then the agent just calls (or relies on lazy auth on first API call):

```text
harbor_authenticate    // no arguments; server signs itself in + picks your store
```

> **Agents:** never ask the user for a password or pass one to a tool. If
> `harbor_authenticate` returns `AUTH_NOT_CONFIGURED`, use `harbor_login_start`.
> `harbor_login` (optional email/password) and `harbor_set_access_token` remain for
> scripted/headless callers that already hold their own credentials.

Token storage: `~/.harborhub/credentials.json` (override with `HARBOR_CREDENTIALS_FILE`;
disable disk caching with `HARBOR_CREDENTIALS_DISABLED=true`). The **password is never
stored** — only tokens. Never commit tokens or `.env`; keep them `chmod 600`.

## Mutation Safety

All write tools are blocked by default. This includes cart, order, shopping-list, authorization, SRP, account, and export mutations.

To allow live changes for a session:

```text
harbor_set_permissions { mutations: "enabled" }
```

The agent should only call this after explaining the exact live change and getting explicit user approval. Mutation tools also require `confirm:true` on the individual call.

`HARBOR_ENABLE_LIVE_MUTATIONS=true` exists as a server-level override for controlled environments, but per-session approval is safer for day-to-day use.

## Configuration

Copy `.env.example` and set values as needed.

| Variable | Default | Purpose |
|----------|---------|---------|
| `HARBOR_API_BASE_URL` | `https://api.harborwholesale.com` | Harbor API base URL |
| `HARBOR_AUTH_DOMAIN` | `harborwholesale.auth0.com` | Auth0 domain |
| `HARBOR_AUTH_AUDIENCE` | `https://api.harborwholesale.com` | Auth0 audience |
| `HARBOR_AUTH_CLIENT_ID` | captured from frontend | Auth0 client id |
| `HARBOR_DEFAULT_CUSTOMER_ID` | unset | Optional default customer/store |
| `HARBOR_DEFAULT_USER_ID` | unset | Optional default Auth0 user id |
| `HARBOR_BEARER_TOKEN` | unset | Server-held bearer token; the server authenticates with it (preferred) |
| `HARBOR_EMAIL` | unset | Server-held Harbor login email; used for self-service password grant + auto-refresh |
| `HARBOR_PASSWORD` | unset | Server-held Harbor password; never passed by or exposed to the agent |
| `HARBOR_CREDENTIALS_FILE` | `~/.harborhub/credentials.json` | Where the refresh/access token cache is stored (password is never stored) |
| `HARBOR_CREDENTIALS_DISABLED` | `false` | `true` keeps tokens in-memory only (no disk cache) |
| `HARBOR_ENABLE_LIVE_MUTATIONS` | `false` | Server-level mutation override |
| `HARBOR_REQUEST_TIMEOUT_MS` | `30000` | Harbor API request timeout |
| `HARBOR_USAGE_SUPABASE_URL` | unset | Supabase project URL for usage tracking |
| `HARBOR_USAGE_SUPABASE_KEY` | unset | Supabase `service_role` key for usage tracking |
| `HARBOR_USAGE_LOG_ARGS` | `true` | Store redacted tool args with each event |
| `HARBOR_USAGE_FLUSH_MS` | `2000` | Background flush interval for usage events |

## Usage Tracking

Every tool call can be logged to a Supabase project so you can see who is using
the MCP, which items they touch, and what they're doing — a lightweight backend.
Tracking is **off by default**; setting the two Supabase env vars turns it on.
Logging is fire-and-forget and batched, so it never slows or breaks a tool call.
Passwords and bearer tokens are redacted before anything is stored.

**Setup (one time):**

1. Create a dedicated HarborHub Supabase project (the free tier is plenty —
   events are <1 KB each).
2. In that project: **SQL Editor → New query**, paste [`db/usage-schema.sql`](db/usage-schema.sql), Run.
3. **Settings → API**: copy the Project URL and the `service_role` key into
   `HARBOR_USAGE_SUPABASE_URL` / `HARBOR_USAGE_SUPABASE_KEY` in your `.env`.
4. `npm run build` and restart the server.

**What you get** (browse in the Supabase Table Editor):

| Object | Shows |
|--------|-------|
| `harbor_usage_events` | One row per tool call: tool, user, customer/store, items, success/error, duration, redacted args |
| `harbor_users` | Per-user roll-up: first/last seen, total calls, error count |
| `harbor_tool_usage` | Most-used tools with error rate + avg latency |
| `harbor_top_items` | Most-touched item numbers |
| `harbor_daily_activity` | Calls + active users + errors per day |

## Tool Highlights

### Agent Setup

- `harbor_setup_check`
- `harbor_get_agent_guide`
- `harbor_health_check`

### Cart

- `harbor_list_cart_lines`
- `harbor_get_cart_summary`
- `harbor_get_cart`
- `harbor_get_order_draft`
- `harbor_get_par_replenishment`
- `harbor_add_to_cart`
- `harbor_add_multiple_to_cart`
- `harbor_remove_cart_item`
- `harbor_remove_multiple_cart_items`
- `harbor_clear_cart`
- `harbor_checkout_cart`

### Catalog

- `harbor_browse_catalog`
- `harbor_search_catalog`
- `harbor_search_autocomplete`
- `harbor_validate_items`
- `harbor_list_harbor_categories`
- `harbor_list_brands`
- `harbor_get_product`
- `harbor_get_buying_options`
- `harbor_find_substitute`

### Orders And Lists

- `harbor_list_open_orders`
- `harbor_get_open_order`
- `harbor_filter_open_order_items`
- `harbor_list_order_history`
- `harbor_list_shopping_lists`
- `harbor_get_shopping_list`
- `harbor_list_blanket_orders`

### Pricing And Account

- `harbor_list_srp_books`
- `harbor_get_srp_book`
- `harbor_get_account`
- `harbor_get_account_balance`
- `harbor_list_resources`

The complete tool manifest lives in [docs/tool-manifest.json](docs/tool-manifest.json).

## Response Format

Every tool returns the same envelope:

```json
{ "success": true, "data": {} }
```

```json
{ "success": false, "error": { "code": "...", "message": "...", "retryable": false } }
```

Common error and validation codes:

| Code | Meaning |
|------|---------|
| `AUTH_REQUIRED` | Not authenticated — call `harbor_authenticate` (no password needed) |
| `AUTH_NOT_CONFIGURED` | Operator hasn't set server-side credentials (`HARBOR_BEARER_TOKEN` or `HARBOR_EMAIL`/`HARBOR_PASSWORD`) |
| `AUTH_EXPIRED` | Token expired or was rejected — call `harbor_authenticate` to re-sign in |
| `STORE_CONTEXT_REQUIRED` | No customer/store context is set |
| `USER_ID_REQUIRED` | Cart tools need an Auth0 user id |
| `SANDBOX_REQUIRED` | Mutation attempted without session permission and `confirm:true` |
| `REQUEST_TIMEOUT` | Harbor API did not respond before `HARBOR_REQUEST_TIMEOUT_MS` |
| `RATE_LIMITED` | Harbor API returned HTTP 429 |
| `Discontinued` | SKU is discontinued or available soon |
| `Unauthorized` | SKU is not authorized for the customer |
| `OutOfStock` | SKU is not currently available |
| `StoreEquipment` | Item appears to be store equipment, not retail product |
| `DisplayFixture` | Item appears to be a display fixture, not retail product |
| `NotFound` | SKU was not found in the customer's sellable catalog |

## Testing

Mocked test suite:

```bash
npm test
```

Build check:

```bash
npm run build
```

Live checklist against real Harbor API:

```bash
HARBOR_TEST_EMAIL=you@example.com \
HARBOR_TEST_PASSWORD=yourpassword \
./node_modules/.bin/tsx tests/live.test.ts
```

Live tests cover login, session info, health check, cart, dashboard, catalog browse/search, open orders, SRP books, and a reversible cart add/verify/remove flow.

## Production Notes

- Keep mutation tools blocked by default in normal agent environments.
- Prefer `harbor_list_cart_lines` for audits; the full cart object can be very large.
- Always run `harbor_validate_items` before batch adds.
- Use `HARBOR_REQUEST_TIMEOUT_MS` to tune reliability for slow networks.
- Treat live order/list/SRP mutation endpoints as high risk unless tested against an approved account.

## Confirmed Live Vs. Inferred

| Group | Status |
|-------|--------|
| Read tools | Confirmed live |
| Cart add/remove | Confirmed live |
| Cart validation and lightweight line projection | Mocked regression covered; uses confirmed item/cart endpoints |
| Open order mutations | Endpoint shapes from network captures; use approved testing before broad rollout |
| Shopping list mutations | Endpoint shapes from network captures; use approved testing before broad rollout |
| Blanket order mutations | Endpoint shapes from network captures; use approved testing before broad rollout |
| SRP mutations | Endpoint shapes from network captures; use approved testing before broad rollout |

## Development

```bash
npm install
npm run build
npm test
```

Keep `docs/tool-manifest.json` synchronized with registered tools. The regression suite checks that the manifest and MCP tool list match.
