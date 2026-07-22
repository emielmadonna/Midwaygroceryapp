# Midway Command Center — Engineering Handoff

_Last updated: 2026-07-22. Hand this whole file to the next session as context._

## What this is
Midway Gas & Grocery's store operations platform. Public storefront + an admin
"Command Center" where a **non-technical owner** runs the store by talking to an
AI assistant ("Ask Midway"). Node ESM, Express API, React admin (no TypeScript,
no build framework beyond Vite). Deployed on Vercel; data in Supabase; the
storefront is midwayplain.com (redirects to www).

## How to run / test / deploy
- Tests: `npm test` (node:test). Build: `npm run build` (Vite). Both must pass before pushing.
- Local API against the REAL prod DB with a test owner login: `npm run api:admin`
  (login `admin@midway.local` / `midway-dev-owner`). Memory-store mode (no prod
  data touched): `npm run api:test`. Dev launch configs are in `.claude/launch.json`
  (names: `midway-dev` port 3000, `midway-api-admin`/`midway-api-test` port 3001).
- Deploy: push to `main` → Vercel auto-deploys. Confirm live by diffing the
  hashed bundle name: `curl -s https://www.midwayplain.com/admin.html | grep -oE 'admin-[A-Za-z0-9_-]+\.js'`
  vs `grep ... dist/admin.html` after `npm run build`. Health: `/api/health`.
- **After any admin UI deploy, hard-refresh the admin tab (Cmd+Shift+R)** — an
  old open tab runs stale JS and shows stale errors.

## Access, credentials, gotchas (READ FIRST)
- **Supabase MCP server connected to Claude is the WRONG project (OutreachPilot).**
  Never use it for Midway. Midway prod is org "Midway", project ref
  `psvqtjaoaambyuugrtbo`, owner account midwayggr@gmail.com. Run Midway SQL via
  the Supabase dashboard in the user's Chrome (they're logged in), or with
  `@supabase/supabase-js` + the real `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
  from `.env.local`. When the SQL editor prompts about RLS, choose **Run without
  RLS** (all command-center tables are service-role only, no RLS — matches existing).
- Local `.env` has placeholder/empty values; **real secrets live in `.env.local`**
  (Vercel-pulled) and in Vercel prod env. `.env` is git-ignored now.
- **`vercel env add` and `vercel env pull` are blocked** by the permission
  classifier in this harness — the user must run those, and must add the OpenAI
  key / QuickBooks creds themselves.
- **OpenAI key encryption mismatch (live issue):** the key is encrypted at rest
  with `PROVIDER_CREDENTIALS_ENCRYPTION_KEY` → `ADMIN_SESSION_SECRET` → ...
  (see `providerEncryptionKey` in `src/lib/provider-connections.js`). A key saved
  under a different secret than prod uses can't be decrypted, so chat fails even
  though a row exists. Status formatters now verify decryptability and show
  "Needs API key". **Fix = the OWNER pastes the key on Connections → Assistant
  brain → Update key (prod re-encrypts under its own secret), OR sets
  `OPENAI_API_KEY` in Vercel prod env as a fallback.** As of handoff the user
  said they'd do this themselves.
- **harborhub-mcp is VENDORED** in `vendor/harborhub-mcp` (the `github:` dep broke
  Vercel builds — no SSH key). `package.json` points at `file:vendor/harborhub-mcp`.
- Harbor live creds (`HARBOR_EMAIL`/`HARBOR_PASSWORD`) are in `.env.local` and in
  the prod vendor connector (encrypted). `scripts/harbor-connector-check.mjs` does
  a live round-trip (needs those env vars; renamed from test-* so `npm test` skips it).

## Architecture quick map
- `src/api/routes.js` — the whole Express API (one big router). Admin routes are
  behind `router.use('/admin', ...)` session auth (HMAC token, `src/lib/admin-auth.js`).
- `src/lib/command-center-service.js` — the core service: inventory, Square sync,
  reconciliations, uploads, vendor connectors, sales analytics, vendor mapping.
- `src/lib/agent.js` — the agent loop + `DEFAULT_SYSTEM_PROMPT`. Tools with
  `sideEffect: 'destructive'` require explicit owner approval before running.
- `src/lib/*-tools.js` — tool registries (command-center, xero, quickbooks).
- `src/lib/ai-providers/openai-provider.js` — OpenAI Responses API wrapper.
- `src/lib/provider-connections.js` — provider defs + encrypted credential storage
  (Square, OpenAI, Xero, QuickBooks, Instagram, Slack, email).
- `src/command-center.jsx` — the ENTIRE React admin as one file. `App` holds state;
  `Assistant`, `ConnectionsView`, `InventoryView`, etc. are components in the same file.
- `src/lib/vendor-mcp.js` — connects to vendor MCP servers (stdio for bundled
  Harbor, http for others). Harbor creds injected per-connection.
- `supabase_command_center_migration.sql` — all command-center tables. Append
  ALTERs for changes; apply them to prod manually via the dashboard.

## Shipped & LIVE this session
- Harbor sign-in from the admin UI (email+password, AES-256-GCM encrypted); vendor
  connectors resolve by name ("Harbor"), auto re-auth + retry. Read-only vendor
  tools (`call_vendor_read_tool`) skip approval; mutating (`call_vendor_mcp_tool`) require it.
- Connections tab: Square, Xero, **OpenAI key card** (encrypted, rotatable — the
  key belongs here, not env), Harbor, QuickBooks — all with real brand SVG logos
  (`BrandLogo` component). Live connector status chips on Ask Midway.
- Agent bug fixes: conversation history persisted in true trace order (was 400ing
  on the 2nd turn); orphaned tool outputs dropped on replay.
- Full-screen Ask Midway; floating chat widget (right side, "+ New chat" + "Full
  screen") on every non-assistant view; chat-history sidebar no longer h-scrolls.
- **Voice agent**: mic button in the composer → OpenAI Realtime (`gpt-realtime`)
  via `POST /admin/agent/voice/session` (mints ephemeral key). Voice calls the
  same store agent through an `ask_midway` tool, so identical powers + approvals.
- Uploads: browser multi-pass image shrink (any photo fits) + **direct-to-storage
  signed-URL upload for files up to 45 MB** (bypasses Vercel's ~4.5 MB body cap).
  Storage bucket `midway-command-center` limit raised to 50 MB; DB size constraint
  widened. `POST /admin/command-center/uploads/direct` mints the signed URL.
- **PDF understanding**: `extractPdfText` (pdfjs) pulls ALL page text server-side
  and injects it so the assistant understands the whole document at once (text-layer
  PDFs). Oversized PDFs also chunk visually down to single pages
  (`shrinkPdfBuffer`, regression-tested in `test/pdf-shrink.test.js`).
- Square sales sync verified penny-accurate (`scripts/verify-sales-sync.mjs`).
- Photo/note counts → review-only reconciliation → apply-on-approval (proven live).
- Low-stock defaults (≤3 when no reorder point set); "Regular" variation noise
  stripped from names; agent knows packs vs cartons (individual sellable units).
- **Vendor self-mapping** tools: `map_item_to_vendor`, `unmap_item_from_vendor`,
  `set_inventory_rule`. **Auto-mapping sweep**: `propose_vendor_mappings` /
  `apply_vendor_mappings` (scan Square catalog → match Harbor by UPC → pull pack
  size + per-unit cost → owner reviews before save). `src/lib/vendor-mapping-sweep.js`.
- **QuickBooks Online connector** (code-complete, awaiting creds): OAuth flow,
  Connections card, 7 tools (`qbo_status/search_customers/list_invoices/list_bills/
  get_pl_summary/create_invoice/record_payment`). `src/lib/quickbooks-{api,service,tools}.js`.
- **Nightly Square→QuickBooks posting** (`src/lib/quickbooks-daily-sales.js`,
  cron `/api/cron/qbo-daily-sales` 10:00 UTC): posts yesterday's net sales + tax as
  a SalesReceipt, idempotent, silent until QBO connected.
- Background stepped Square sync with progress counter (`startSquareSyncJob`/
  `stepSquareSyncJob`/`getSquareSyncJob`, table `square_sync_jobs`).

## OPEN — needs the OWNER (not code)
1. **OpenAI key**: paste on Connections → Assistant brain → Update key on
   midwayplain.com (or add `OPENAI_API_KEY` to Vercel prod env). This is the ONLY
   thing blocking chat/voice/file-analysis from working live right now.
2. **QuickBooks app**: create at developer.intuit.com → redirect URI must be
   EXACTLY `https://www.midwayplain.com/admin.html?provider=quickbooks` (query
   string included) → put `QUICKBOOKS_CLIENT_ID`/`QUICKBOOKS_CLIENT_SECRET` in
   Vercel prod env → owner clicks Connect QuickBooks. Then live-test the 7 tools
   and confirm the daily SalesReceipt lands in the right income account (it uses
   ItemRef '1' by default — verify).
3. **Bullock fuel POS**: it's "basically just a computer that runs the system."
   Need a photo of the console/brand and whether there's a web portal login for
   gas reports. Then scope: portal-login connector (like Harbor) vs report ingestion.

## SHIPPED 2026-07-22 (second pass — was "remaining engineering")
1. **Documents read fully, automatically.** Text-layer PDFs: full text injected
   (was already live). Scanned PDFs (no text layer): `parseAgentAttachments`
   (src/api/routes.js) now loops `readUploadContent({pageStart})` over ALL page
   ranges in the SAME turn. If every range fits the ~24 MB budget they are all
   attached as labeled `input_file` parts; if not, each range is transcribed by
   an OpenAI vision pass (`transcribeChunk` in runAdminAgentTurn, same saved
   key) and the complete transcription is injected as text. The owner is never
   asked to "keep reading". Only if transcription also fails does the assistant
   say honestly what it could read.
2. **Live ingestion progress** — `attachment_progress` ("Reading page 12 of 40
   in file.pdf", "Transcribing pages 21–40 …") and `attachment_completed` events
   stream over `POST /admin/agent/turn/stream` and render in the LiveAssistant
   activity list.
3. **Live MCP/tool activity** — `tool_started` events now carry
   `connector`/`innerTool`/`apiPath`/`subject`; `friendlyToolActivity` renders
   "Harbor · search catalog", "Square · payments" style labels.
4. **Full Square control** — new agent tools: `create_square_item` (auto-assigns
   the next numeric item number ≥1001 when no SKU given; find-or-creates the
   category; sets initial stock; absorbs the item into local inventory
   immediately), `update_square_item`, `set_square_item_stock`,
   `delete_square_item`, plus `call_square_read_api` (GET, no approval) and
   `call_square_api` (POST/PUT/DELETE, approval-gated) reaching EVERY Square v2
   endpoint. Service fns in command-center-service.js; payload builder
   `buildSquareItemObject` in square-api.js (tested).
5. **Full QuickBooks reach (pending creds)** — `qbo_query` (any QBO query) and
   `qbo_api_request` (any entity create/update, approval-gated) join the 7
   typed tools.
6. Agent turn budget raised (MAX_ITERATIONS 10 → 40) so whole-document actions
   (e.g. creating dozens of items from one invoice) finish in one turn.

## Follow-ups (small)
- QBO income-account check after the owner connects; auto-mapping-sweep UI
  button (tools exist); Square sync progress bar polish; voice real-world QA.

## Test/verify scripts (in scripts/, run with node from repo root)
- `verify-sales-sync.mjs` — Square API vs stored sales, penny check.
- `harbor-connector-check.mjs` — live Harbor round-trip (needs HARBOR_* env).
- Ad-hoc E2E scripts were used for uploads/agent and cleaned up; recreate as needed.

## Conventions
- Plain JS ESM, semicolons, single quotes, 2-space indent. Match surrounding code.
- Never log/echo secrets. Destructive tools require approval. Confirm outward-facing
  or irreversible actions with the user. Keep the owner-facing voice warm, brief,
  non-technical (see DEFAULT_SYSTEM_PROMPT).
