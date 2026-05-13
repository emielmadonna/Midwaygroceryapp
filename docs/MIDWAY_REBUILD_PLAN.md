# MidwayOS Website and Operations Platform Plan

Last updated: May 8, 2026

## 1. North Star

MidwayOS is the working name for the full Midway website and operations platform.

Midway should feel simple to customers and simple to operate from a phone.

The public website should be a polished, local, farmhouse-style single page for Midway in Plain, Washington: fuel, bait, tackle, coffee/espresso, convenience, ice, and RV sites. The backend should be a private mobile-first dashboard that lets staff and owners manage RV bookings, Square payments, inventory, sales, hours, announcements, photos, and AI-assisted operational tasks without needing a developer for normal changes.

The goal is a closed-loop business platform:

1. Customers discover Midway through local search, maps, and area-specific SEO.
2. Customers view RV availability on a property map.
3. Customers book a specific RV site and pay upfront through Square.
4. Square remains the source of truth for payments, catalog items, inventory, and sales where possible.
5. The Midway dashboard shows bookings, sales, low stock, and action items.
6. Staff can update the business from a phone using forms or natural-language AI commands.
7. The system records what happened so future AI suggestions improve over time.

Core operating doctrine:

**Automate the normal. Surface the exceptions. Keep the owner out of the weeds.**

## 2. Business Identity

Working business details:

- Name: Midway
- Location: Plain, Washington
- Prior name: Village
- Visual identity: black and white logo
- Brand feel: polished, local family-owned, quaint, stylish, simple farmhouse
- Business categories: convenience store, gas/fuel, bait, tackle, coffee/espresso, ice, RV sites, firewood, water/sewer/electric hookups

Messaging direction:

- "The local stop in Plain for fuel, coffee, bait, tackle, ice, and RV stays."
- "A simple mountain stop between Leavenworth, Lake Wenatchee, and Stevens Pass."
- "Book an RV site, grab espresso, fill up, and get what you need for the day."

## 3. Customer Perspective

Customers should immediately answer these questions:

- Are you open right now?
- Do you have gas, diesel, ice, coffee, bait, tackle, firewood, and basic supplies?
- Where are you?
- Can I book an RV site?
- Which RV spots are available?
- What amenities does each spot have?
- How much does it cost?
- Can I pay right now?
- Can I call or text if I have a question?

The customer flow should be:

1. Land on website.
2. See Midway name, vibe, location, and main actions.
3. Tap "Book RV Site" or "Call/Text".
4. See property map with each RV spot.
5. Tap a spot to view amenities, price, photos, and availability.
6. Pick dates.
7. Enter contact details.
8. Pay in full through embedded Square payment.
9. Receive confirmation by email and/or SMS.
10. Booking appears immediately in the owner/staff dashboard.

## 4. Public Website Scope

The public website should stay single-page and low-maintenance.

Recommended sections:

1. Header
   - Logo
   - Call button
   - Text button
   - Book RV Site button
   - Minimal navigation anchors

2. Hero
   - Midway as the first visual signal
   - Real exterior/store/RV image once available
   - Current open/closed status
   - Primary CTA: Book RV Site
   - Secondary CTA: Get Directions
   - Fuel price chips if owner wants them public

3. What We Carry
   - Fuel
   - Diesel
   - Coffee / espresso
   - Bait and tackle
   - Ice
   - Firewood
   - Snacks, groceries, drinks
   - Camping/RV essentials

4. RV Sites
   - Short intro
   - Live property map preview
   - Available/taken status
   - "Book a Site" CTA

5. Location and Area
   - Plain, WA location
   - Google Maps embed or static map with directions link
   - Nearby area copy for Leavenworth, Lake Wenatchee, Stevens Pass, Plain Valley, Wenatchee River

6. Instagram
   - Embedded Instagram profile/feed
   - Fallback link if Instagram embed fails

7. Hours and Contact
   - Live hours
   - Call
   - Text
   - Directions
   - Optional email/contact form only if needed

8. Local SEO Footer
   - Address
   - Phone
   - Business categories
   - Structured data
   - Links to booking, directions, Instagram

What not to put on the public site:

- A complex online store at first
- A large menu of every inventory item
- Heavy content management screens
- Anything that requires staff to maintain duplicate data outside Square

## 5. Visual Direction

Farmhouse here should mean refined, restrained, local, and durable, not decorative clutter.

Design direction:

- Use the black and white logo as the anchor.
- Use warm whites, charcoal, muted green, weathered wood, deep red accents, and neutral stone colors.
- Use real photography as soon as available.
- Keep typography readable and confident.
- Avoid a one-note beige/brown theme.
- Avoid overly cute rustic design.
- Use compact mobile-first sections with clear buttons.
- Make the RV booking and directions actions impossible to miss.

Suggested visual ingredients:

- Black/white logo lockup
- White or warm-white page background
- Charcoal text
- Subtle farmhouse textures only if they do not hurt loading speed
- Real photos of store front, coffee, RV area, bait/tackle wall, ice/freezer, fuel pumps, firewood
- Simple icons for fuel, coffee, bait, tackle, ice, RV, firewood

## 6. RV Booking System

Working requirements:

- About 14 RV sites
- Site-specific amenities
- Full payment upfront
- Embedded calendar
- Embedded Square payment
- Property map showing available, booked, blocked, and selected sites
- Owner/staff ability to manage rules later

RV site data model:

- Site number/name
- Map position
- Status
- Nightly price
- Description
- Photos
- Max RV length
- Electric hookup
- Water hookup
- Sewer hookup
- Firewood available
- Picnic/fire area if applicable
- Pull-through or back-in
- Pet policy
- Notes visible to customers
- Private admin notes
- Active/inactive

Booking data model:

- Booking ID
- Site ID
- Customer name
- Customer phone
- Customer email
- Start date
- End date
- Number of nights
- Guests
- Vehicles
- Add-ons
- Subtotal
- Taxes/fees
- Total
- Square order ID
- Square payment ID
- Payment status
- Booking status: pending, paid, confirmed, canceled, refunded, blocked
- Source: website, admin, phone, AI command
- Created by
- Created at
- Updated at

Booking rules to support:

- Check-in time
- Check-out time
- Minimum nights
- Maximum stay
- Same-day booking cutoff
- Cancellation window
- Full refund/partial refund/no refund rules
- Site-specific blackout dates
- Seasonal pricing
- Holiday pricing
- Cleaning/site fee if applicable
- Optional add-ons

Customer booking UX:

1. Choose dates first or choose site first.
2. See map update instantly.
3. Tap a site.
4. See price, amenities, availability, and site notes.
5. Continue to checkout.
6. Pay securely using Square Web Payments SDK.
7. Confirmation screen and confirmation message.

Important booking rule:

- A booking should not become confirmed until payment succeeds.
- The system should temporarily hold the selected site during checkout to prevent double-booking.

## 7. Property Map

The property map is one of the most important differentiators.

Map goals:

- Let customers understand the property fast.
- Let staff see booked/open/blocked sites instantly.
- Avoid needing a complicated GIS system.

Recommended implementation:

- Start with a custom illustrated SVG or HTML/CSS map based on the actual property layout.
- Each RV spot is an interactive region.
- Status colors:
  - Available
  - Selected
  - Booked
  - Blocked/maintenance
  - Unavailable for selected dates
- On tap/click, open a bottom sheet on mobile with spot details.

Admin map features:

- Tap a site to edit amenities, price, photos, or notes.
- Tap dates to block/unblock.
- See current guest, check-in/check-out, and payment status.
- Add a phone booking manually.

Needed from owner:

- A rough drawing, photo, or satellite screenshot of the RV area.
- Numbered site list.
- Amenities for each site.
- Which sites are better/worse/preferred.

## 8. Square Integration

Square should be used for payments and, where practical, catalog/inventory/sales data.

Square components likely needed:

- Web Payments SDK for embedded card/payment UI
- Payments API to charge the buyer
- Orders API to create itemized RV bookings/add-ons and store sales records
- Catalog API for products, add-ons, and possibly RV site products/services
- Inventory API for stock counts and low-stock visibility
- Customers API for customer profiles
- Locations API to map inventory and payments to the correct Square location
- Webhooks to keep Midway in sync when Square changes

Important Square notes:

- The Web Payments SDK creates a secure payment token in the browser, then the backend creates the payment.
- Inventory should remain Square-first where possible.
- Square inventory is tied to catalog item variations and location.
- If an online order uses Square Orders correctly and inventory tracking is enabled, Square can adjust stock when payment/order completes.
- Square Bookings API exists, but it is appointment/service-oriented and may not be the best primary engine for campground-style nightly RV site reservations. We should evaluate it, but a custom RV booking layer plus Square payments/orders is likely cleaner.

Proposed Square architecture:

1. Midway app owns RV availability, property map, and booking rules.
2. Midway app creates a Square Order for RV stay and add-ons.
3. Customer pays through Square Web Payments SDK.
4. Midway stores Square payment/order IDs on the booking.
5. Square webhooks update payment, refund, and inventory state.
6. Dashboard reads Square sales/inventory data and caches only what is needed for speed.

Square source links:

- Square developer platform: https://developer.squareup.com/docs
- Square Web Payments SDK quickstart: https://developer.squareup.com/docs/web-payments/quickstart
- Square Inventory API overview: https://developer.squareup.com/docs/inventory-api/what-it-does
- Square Inventory process flow: https://developer.squareup.com/docs/inventory-api/how-it-works
- Square Bookings API overview: https://developer.squareup.com/docs/bookings-api/what-it-is

## 9. Dashboard Scope

When the owner opens the dashboard on a phone, the first screen should answer:

- What needs my attention right now?
- Who is arriving today?
- Which RV sites are booked tonight?
- How much did we sell today?
- What is low stock?
- Are fuel prices/hours correct?

Recommended dashboard home:

1. Today cards
   - Today's sales
   - Open RV sites tonight
   - Arrivals today
   - Departures today
   - Low-stock items

2. Quick actions
   - Add booking
   - Block RV site
   - Update fuel price
   - Update hours
   - Add announcement
   - Scan/count inventory
   - Ask AI

3. Alerts
   - Payment failed
   - Low stock
   - Booking conflict
   - Upcoming arrivals
   - Fuel inventory low

4. AI command box
   - "Block site 7 this weekend."
   - "What RV sites are open next Friday?"
   - "Change diesel to 4.29."
   - "Order more firewood."
   - "Show low-stock bait and tackle."
   - "What sold best this week?"

Core dashboard areas:

- Overview
- RV map/calendar
- Bookings
- Square sales
- Inventory
- Fuel
- Website content
- Customers
- Staff/users
- Settings
- AI activity log

Owner vs employee roles:

- Owner:
  - Full dashboard access
  - Payments/refunds
  - Square sync
  - User management
  - AI approval settings
  - Reporting

- Employee:
  - View bookings
  - Add manual booking if allowed
  - Check in/out guests
  - Update inventory counts
  - Update fuel prices/hours if allowed
  - Cannot change payment settings or delete records

## 10. AI Layer

The AI layer should make operations easier, but it should not silently make high-risk business changes at first.

AI goals:

- Query business data quickly.
- Change simple website content.
- Help manage Square catalog/inventory.
- Draft orders.
- Explain sales and low-stock patterns.
- Help staff perform tasks from a phone.
- Learn from actions, corrections, and outcomes.

AI command examples:

- "Which RV sites are open this weekend?"
- "Book site 3 for Sarah from June 7 to June 10."
- "Block sites 8 and 9 next Tuesday for maintenance."
- "Update hours to 6am to 9pm all week."
- "What should we reorder before Memorial Day weekend?"
- "Show me the best-selling drinks this month."
- "Add firewood as an RV checkout add-on for $8."
- "What did we run out of last weekend?"

AI safety model:

- Low-risk actions can be immediate:
  - Answering questions
  - Drafting summaries
  - Updating internal notes
  - Creating a draft reorder list

- Medium-risk actions require confirmation:
  - Changing website hours
  - Blocking RV dates
  - Adding/modifying products
  - Updating inventory counts

- High-risk actions require owner approval:
  - Refunds
  - Placing vendor orders
  - Changing prices in Square
  - Deleting products
  - Changing payment settings
  - Giving staff access

Closed-loop learning:

- Store every AI command, proposed action, approval/denial, final result, and correction.
- Track which recommendations were accepted.
- Track stockouts, low-stock alerts, reorders, and sales after reorder.
- Use this history to improve future reorder suggestions and seasonal forecasts.

Important implementation principle:

- The AI should use tools with strict permissions rather than direct unrestricted database or Square access.

## 11. Texting and Calling

Customer contact should be simple:

- Call button using `tel:`
- Text button using `sms:`
- Optional website contact form later
- Optional business SMS integration later

Possible SMS providers:

- Twilio
- Square Messages if it fits the workflow
- A business texting platform with API support

Recommended first version:

- Use regular call/text links on the public site.
- Send booking confirmations by email first.
- Add SMS confirmations once provider/API is selected.

## 12. Inventory and Sales

Inventory ambition:

- All store products visible/manageable enough for low-stock awareness.
- Square should remain the primary place where POS sales happen.
- Midway dashboard should surface what matters, not replace Square's full dashboard on day one.

Inventory features:

- Sync products from Square Catalog.
- Sync stock counts from Square Inventory.
- Low-stock alerts.
- Item search.
- Category filters.
- Staff count adjustments with audit trail.
- Barcode scanning later if needed.
- AI reorder suggestions.
- Vendor/order draft workflow later.

Sales features:

- Today's sales
- Sales by day/week/month
- Top items
- RV revenue
- Fuel visibility if available in Square/POS data
- Payment/refund visibility
- Export/reporting later

## 13. Accounting and Admin Offload

The deeper goal of MidwayOS is to keep operational and administrative work off the convenience store owner.

The owner should not reconcile Square sales, RV payments, refunds, taxes, payout timing, vendor purchases, and bank deposits by hand. MidwayOS should prepare accounting-ready summaries, match payouts, surface exceptions, and route approved records to QuickBooks Online or another accounting platform.

Accounting goals:

- Daily accounting-ready sales summaries
- Square payout reconciliation
- RV revenue separated from store/fuel/product revenue
- Sales tax, Square fees, refunds, and discounts separated
- Exception queue instead of raw transaction review
- Accountant export packet
- QuickBooks Online integration later
- AI explanations for mismatches and unusual activity

Recommended first approach:

- Start with export/review mode.
- Let Square remain the payment/POS source of truth.
- Use MidwayOS to match RV bookings, Square payments, payouts, and operational context.
- Add QuickBooks sync only after the owner/accountant approves the chart-of-accounts mapping.

See [accounting-automation.md](./accounting-automation.md) for the detailed accounting plan.

## 14. SEO and GEO Strategy

Midway needs to rank for both direct local intent and nearby area intent.

Primary local intent:

- Midway Plain WA
- Midway gas Plain WA
- gas station Plain WA
- convenience store Plain WA
- bait and tackle Plain WA
- espresso Plain WA
- ice Plain WA
- RV sites Plain WA
- RV hookups Plain WA

Nearby/geo intent:

- Leavenworth WA gas and convenience
- Lake Wenatchee supplies
- Stevens Pass road trip stop
- Plain Valley convenience store
- Wenatchee River bait tackle
- camping supplies near Lake Wenatchee
- firewood near Plain WA
- RV camping near Leavenworth WA

Area content signals:

- Plain Valley is between Leavenworth and Stevens Pass.
- Lake Wenatchee State Park is nearby.
- Leavenworth is a major visitor destination.
- The area has year-round recreation: skiing, hiking, camping, fishing, river activities, snow travel, lake trips.

SEO implementation checklist:

- Fast single-page site
- Proper title/meta description
- Open Graph image
- LocalBusiness structured data
- GasStation/Store/RVPark schema where appropriate
- NAP consistency: name, address, phone
- Embedded Google Map or directions link
- Service-area/location copy
- Image alt text
- FAQ schema for RV booking, hookups, firewood, bait/tackle, ice, hours
- XML sitemap
- Robots file
- Google Business Profile optimization
- Bing Places
- Apple Business Connect
- Consistent citations/directories

Recommended SEO page structure:

- Keep the main site single-page.
- Add hidden-from-nav but public SEO landing pages later only if useful:
  - `/rv-sites-plain-wa`
  - `/bait-tackle-plain-wa`
  - `/gas-station-plain-wa`
  - `/lake-wenatchee-supplies`

Sources for area positioning:

- Leavenworth/Plain visitor information: https://www.leavenworthwa.net/plain/
- Visit Chelan County Plain Valley overview: https://www.visitchelancounty.com/

## 15. Technical Architecture

Recommended stack for lightweight management:

- Frontend: Vite or Next.js depending deployment needs
- Backend/API: Node.js
- Database/auth/storage: Supabase
- Payments/POS/inventory: provider adapter first, Square first implementation
- Accounting: provider adapter first, export-only first, QuickBooks Online later
- AI: OpenAI tool-calling layer with audited actions
- MCP: agent-facing tools/resources/prompts layer
- Hosting: Vercel, Netlify, or similar for frontend/API, plus Supabase

Architecture rules:

- MidwayOS owns business objects.
- Providers are swappable adapters.
- Square, QuickBooks, SMS, email, maps, and social integrations must not leak through the app.
- Provider setup should be one-click OAuth wherever supported.
- Export-only mode must remain available for accounting.
- Feature flags control modules by platform, tenant, location, role, and environment.
- Platform admins can enable, disable, preview, and lock features per business/location/role.
- Public frontends are rendered from theme skins, section config, content, and feature flags.
- Frontend UI should look bespoke through curated skins and sections, not custom forks.
- Regression tests must protect booking, payment, provider, accounting, auth, AI, and MCP behavior.

Current repo already contains:

- Vite frontend
- Admin page
- Supabase client
- Supabase schema for fuel/hours/inventory notes
- Square handler
- Slack/OpenAI server concept

Current repo concerns:

- The Square handler appears incomplete and should be rebuilt against the currently installed Square SDK.
- Admin authentication is currently too simple for production.
- Existing rental model only tracks count, not individual RV sites or real bookings.
- The current frontend is useful as a prototype but should be replaced with the new plan.

Recommended production data tables:

- users
- roles
- site_settings
- site_announcements
- media_assets
- rv_sites
- rv_site_amenities
- rv_bookings
- rv_booking_holds
- rv_booking_addons
- square_sync_state
- square_events
- provider_connections
- provider_events
- tenants
- locations
- feature_flags
- frontend_configs
- tenant_domains
- accounting_connections
- accounting_batches
- accounting_exceptions
- inventory_cache
- low_stock_alerts
- fuel_prices
- fuel_inventory
- ai_commands
- ai_actions
- ai_memories
- audit_log

## 16. Phase Plan

Phase 0: Planning and design foundation

- Confirm business identity and address/phone
- Collect logo and photos
- Confirm RV site count and amenities
- Draw property map
- Confirm Square account/API access
- Finalize booking rules
- Finalize public site layout

Phase 0.5: Foundation and regression harness

- Establish module boundaries
- Add provider adapter interfaces
- Add one-click OAuth connection model
- Add feature flag matrix and evaluator
- Add frontend section/theme config model
- Add host/domain-aware tenant resolution skeleton
- Add auth/roles/permissions skeleton
- Add test harness
- Add CI plan
- Add critical regression suite shell
- Add fixtures for 14 RV sites, bookings, provider events, and users

Phase 1: Public site rebuild

- Build single-page farmhouse Midway site
- Build dynamic frontend section renderer
- Build `midway_farmhouse` theme skin
- Build platform-ready public section config
- Build preview/publish path for frontend config
- Add SEO metadata and structured data
- Add Instagram embed
- Add call/text/directions
- Add RV booking entry point
- Add dashboard login shell
- Capture visual regression baseline

Phase 2: RV booking MVP

- Create RV site database
- Build property map
- Build availability engine
- Build booking calendar
- Add temporary holds
- Add Square embedded checkout
- Add confirmation flow
- Add admin booking/calendar/map management

Phase 3: Dashboard MVP

- Mobile-first overview
- Owner/employee login
- Today's bookings
- Arrivals/departures
- Site status
- Website content controls
- Fuel prices/hours controls
- Audit log

Phase 4: Square operations

- Square catalog sync
- Square inventory sync
- Square sales dashboard
- Low-stock alerts
- Product search
- Basic reorder suggestions

Phase 5: Accounting automation

- Daily accounting summaries
- Square payout reconciliation
- Tax, fee, refund, and discount summaries
- Accounting exception queue
- Accountant export packet
- QuickBooks Online integration prototype

Phase 6: MCP and AI operations layer

- MCP server tools/resources/prompts
- Natural-language query dashboard
- AI command approvals
- Provider-safe tool actions
- Booking-safe tool actions
- Reorder suggestions
- Accounting exception explanations
- Learning/audit history

Phase 7: Advanced operations

- SMS confirmations
- Vendor order workflow
- Barcode scanning
- Forecasting
- Seasonal SEO pages
- More advanced reporting

See [implementation-phases.md](./implementation-phases.md) for subagent ownership per phase.
See [testing-strategy.md](./testing-strategy.md) for release gates and regression requirements.
See [provider-adapters.md](./provider-adapters.md) for swappable provider design.
See [mvp-plan.md](./mvp-plan.md) for the focused first-launch build.
See [domain-management.md](./domain-management.md) for future custom domain support.

## 17. MVP Definition

To "win off the bat," the MVP should include:

- A beautiful, simple Midway public site
- Correct business info
- Call/text/directions
- Instagram embed
- RV property map
- 14 RV sites with amenities
- Booking calendar
- Full Square payment upfront
- Confirmation
- Admin dashboard for bookings and site availability
- Basic website content management
- SEO foundation

What can wait:

- Full inventory management
- AI placing orders
- Barcode scanning
- Advanced Square sales analytics
- Complex seasonal pricing
- SMS automation
- Separate SEO landing pages

Regression-proof MVP requirements:

- Critical regression suite exists and runs.
- Booking overlap tests pass.
- Provider adapter contract tests exist.
- Payment confirmation is tested against Square sandbox or live Square provider flows only.
- Webhook idempotency is tested.
- Owner/employee permission tests pass.
- Public site and RV map have visual regression baselines.

## 18. Decisions Needed

Highest-priority decisions:

1. Confirm exact address and phone.
2. Confirm Instagram handle.
3. Confirm whether there are exactly 14 RV sites.
4. Provide or sketch the property map.
5. List amenities per RV site.
6. Confirm nightly pricing and whether every site has the same price.
7. Confirm taxes/fees.
8. Confirm cancellation/refund policy for launch.
9. Confirm Square account access and location ID.
10. Decide whether bookings need email confirmation only for MVP or SMS too.

Brand/content decisions:

1. Upload logo.
2. Gather exterior/store/RV/fuel/coffee/bait/tackle/ice photos.
3. Decide whether to display live fuel prices publicly.
4. Decide whether to mention the old Village name for SEO/history.
5. Decide whether the public brand name is "Midway", "Midway Gas & Grocery", or another exact name.

Operations decisions:

1. Which employees need access?
2. What can employees edit?
3. Who can issue refunds?
4. Who approves AI actions?
5. What vendor/order process exists today?

## 19. Open Questions for Owner

RV:

- Are all 14 RV sites currently active?
- Are they numbered already?
- Which sites have electric, water, sewer, firewood access, pull-through, shade, or length limits?
- Is full payment always required?
- Are there taxes or lodging fees?
- Are pets allowed?
- What are check-in/check-out times?
- Do you need monthly stays?

Square:

- Is Square already the live POS?
- Is the product catalog already clean enough to sync?
- Is inventory tracking already enabled for products?
- Do fuel sales run through Square or a separate fuel POS?
- Do you already use Square Appointments/Bookings?

Dashboard:

- Should the dashboard be accessed at `/admin`, a hidden path, or a separate app subdomain?
- Should staff use email/password, magic link, or PIN?
- Should employees be able to see sales totals?

AI:

- Do you prefer AI commands in the dashboard, Slack, text message, or all of the above?
- What actions should AI never do without owner approval?
- Do you want AI to talk to customers eventually, or only help staff?

Website:

- What is the exact Instagram handle?
- Do you want a contact form, or just call/text?
- Are there cabins or only RV sites?
- Should the site display bait/tackle/firewood inventory or just say it is available?
