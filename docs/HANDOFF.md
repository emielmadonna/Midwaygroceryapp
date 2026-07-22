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

## REMAINING ENGINEERING (the user's latest asks — NOT yet built)
1. **Read ALL pages automatically, including scanned PDFs with no text layer.**
   Text-layer PDFs are solved (full text injected). For SCANNED PDFs (no text),
   the server still only attaches the first visual chunk and leaves a note. TODO:
   in `parseAgentAttachments` (src/api/routes.js), when a PDF has no `fullText`
   and `lastPage < totalPages`, loop `readUploadContent({pageStart})` over ALL
   remaining ranges and append each as an `input_file` content part in the SAME
   turn (respect a combined ~30 MB budget; if it genuinely can't fit, THEN say so
   honestly). Never rely on the user saying "keep reading." Consider OCR
   (tesseract.js or an OpenAI vision pass per page) for truly text-less scans so
   understanding doesn't depend on how many image pages fit.
2. **Live ingestion progress** — the user wants real-time progress counts while a
   document is being ingested/parsed (e.g. "reading page 12 of 40"). The SSE
   stream endpoint is `POST /admin/agent/turn/stream` (emits events via `onEvent`;
   `attachment_started` already fires). Add per-page/per-chunk progress events
   from the upload-read path and render them in the composer's live activity area
   (`LiveAssistant` component in src/command-center.jsx already renders an activity
   list from `liveActivity`).
3. **Live MCP activity UI** — show which MCP/vendor server is being used and what
   it's doing, in real time. Tool lifecycle events already flow through the agent
   loop (`tool_started`/`tool_completed` in src/lib/agent.js, surfaced via onEvent
   and `friendlyToolActivity` in src/command-center.jsx). Extend: label vendor MCP
   calls with the server + tool name, show a running list ("Harbor · searching
   catalog", "QuickBooks · posting invoice"), and keep counts. The plumbing exists;
   this is mostly UI + richer event payloads.
4. Follow-ups: QBO income-account check post-connect; auto-mapping-sweep UI (tools
   exist, no button yet); Square sync progress bar polish; voice real-world QA.

## Test/verify scripts (in scripts/, run with node from repo root)
- `verify-sales-sync.mjs` — Square API vs stored sales, penny check.
- `harbor-connector-check.mjs` — live Harbor round-trip (needs HARBOR_* env).
- Ad-hoc E2E scripts were used for uploads/agent and cleaned up; recreate as needed.

## Conventions
- Plain JS ESM, semicolons, single quotes, 2-space indent. Match surrounding code.
- Never log/echo secrets. Destructive tools require approval. Confirm outward-facing
  or irreversible actions with the user. Keep the owner-facing voice warm, brief,
  non-technical (see DEFAULT_SYSTEM_PROMPT).
