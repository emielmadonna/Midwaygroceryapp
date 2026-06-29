# Midway — Local SEO Playbook (RV Park & Tent Camping)

Goal: rank in the Plain / Leavenworth / Lake Wenatchee area for searches like
`RV park near Leavenworth`, `tent camping near Lake Wenatchee`,
`campground Plain WA`, `Chiwawa Loop Road camping`.

**The big picture:** for "RV park near me / near Leavenworth" searches, Google shows a
**map pack** (3 pins with reviews). That is controlled by your **Google Business Profile,
reviews, and citations** — NOT your website. The website (now improved) wins the regular
results *below* the map and feeds the booking flow. So the highest-leverage work is
off-site. Do Section 1 and 2 first.

---

## 0. What's already been done on the website (June 2026)

These shipped on branch `fix/hours-single-source-of-truth`:

- **`sitemap.xml` + `robots.txt`** added (`public/`). Submit the sitemap in Google Search Console.
- **Expanded homepage schema** (`index.html`): geo-coordinates, area served (Plain / Leavenworth /
  Lake Wenatchee / Chiwawa valley), amenities, image array, `@id` for cross-linking.
- **Two dedicated, indexable landing pages** — the biggest organic win:
  - `/rv-park` — targets "RV park near Leavenworth", full-hookup keywords.
  - `/tent-camping` — targets "tent camping near Lake Wenatchee".
  - Each has unique title/meta, `Campground` + `BreadcrumbList` + `FAQPage` schema, real
    local copy, FAQs, and CTAs into the booking flow. They're static HTML so Google indexes
    them reliably (no JS execution needed).
- **Internal links** from the homepage booking section to both pages (keyword-rich anchors).
- **Image alt text** fix on product images.
- Mobile **left ribbon** now fills the full viewport height (was leaving a gap on phones).

### Still needs YOUR input (website)
- [ ] **Google Analytics 4** — create a GA4 property for `midwayplain.com`, send me the
      Measurement ID (`G-XXXXXXXX`) and I'll wire it into `index.html` + the landing pages.
- [x] **Amenities** — added Wi-Fi and portable restrooms (2 porta-potties) to schema + landing pages.
      Still tell me about any others to add (showers, dump station, picnic tables, max rig length,
      ADA access, etc.) so we list everything campers filter for.
- [ ] After deploy: in **Google Search Console**, add the property and submit
      `https://www.midwayplain.com/sitemap.xml`. Then "Request indexing" for `/rv-park` and `/tent-camping`.

---

## 1. Google Business Profile (GBP) — do this first

You confirmed the camping operates under the **"Midway"** name (no separate campground sign),
so this is **ONE Google Business Profile with multiple categories** — NOT a second listing.
A second listing for the same business at the same address violates Google's guidelines and
risks suspension.

### Setup / cleanup checklist
- [ ] Claim & verify the listing at business.google.com (if not already).
- [ ] **Primary category:** keep it as your core business (e.g. *Convenience store* or
      *Gas station* — whichever matches most of your revenue/traffic).
- [ ] **Additional categories:** add **Campground** and **RV park**. (Additional categories
      are what make you eligible to show for camping/RV searches. They're slightly weaker than
      the primary, which is the trade-off — see note below.)
- [ ] **Hours:** set store hours + a note that fuel is 24/7. **GBP is the authority Google uses
      for hours in search** — this is why we did NOT hardcode hours into the website schema.
      Keep GBP hours current; that's the single source for what shows in Google.
- [ ] **Photos:** upload 10+ real photos — RV sites with hookups, tent sites, fire pits, the
      store, fuel island, the view. Geo-tagged, recent. Add new ones monthly (freshness signal).
- [ ] **Services / attributes:** turn on every relevant one (RV hookups, pets allowed, etc.).
- [ ] **Description:** work in "Plain, WA", "near Leavenworth", "Lake Wenatchee", "Chiwawa Loop Road".
- [ ] **Website field:** point the campground-relevant link to `https://www.midwayplain.com/rv-park`
      (you can set the main URL to the homepage and use Google Posts to link the landing pages).
- [ ] **Products/Posts:** post seasonally ("RV sites open for summer", events) — free, and it helps.

> **Strategic note on the primary category:** if growing the campground is the #1 priority and the
> store already gets found by name, you *could* flip the primary to *Campground* to maximize camping
> visibility — at the cost of some "gas station / store" ranking. Recommended default: keep the store
> primary + camping as additional categories, and revisit after a few months of data. It's a setting
> you can change.

---

## 2. Citations & camping directories (NAP everywhere)

"NAP" = Name, Address, Phone. It must be **byte-for-byte identical** everywhere or it dilutes
your ranking. Use exactly:

```
Midway Gas & Grocery
14193 Chiwawa Loop RD, Leavenworth, WA 98826
(509) 596-1076
https://www.midwayplain.com
```

### General citations
- [ ] Google Business Profile (Section 1)
- [ ] Bing Places
- [ ] Apple Maps / Apple Business Connect
- [ ] Yelp
- [ ] Facebook Page

### Camping / RV directories — high value, niche-relevant (RVers actually search these)
Each one is both a citation **and** a backlink **and** a place travelers discover you. List on:
- [ ] **The Dyrt** (thedyrt.com) — huge for tent + RV campers
- [ ] **Campendium** (campendium.com)
- [ ] **AllStays** (allstays.com)
- [ ] **FreeRoam** (freeroam.app)
- [ ] **RV LIFE / RV Parky** (rvparky.com)
- [ ] **Good Sam** (goodsam.com) — RV-focused
- [ ] **Hipcamp** (hipcamp.com) — can also drive bookings directly
- [ ] **RoverPass** (roverpass.com) — listings + reservation tooling
- [ ] **Recreation.gov / Campground reviews** where applicable

> Tip: claim the listing if it already exists (directories often auto-create stubs). Make sure
> every one links to `midwayplain.com` and uses the exact NAP above.

---

## 3. Reviews — the #1 lever in the map pack

More (recent, positive) Google reviews ≈ higher map ranking + more clicks. Even 15–25 reviews
will beat an empty competitor.

- [ ] Generate your Google review short-link (from GBP → "Ask for reviews").
- [ ] Print a small **QR code** card for the register and the campsite check-in: "Camped with us?
      Leave a quick review →".
- [ ] Ask every happy camper at checkout. The ask is what moves the needle.
- [ ] Reply to every review (good and bad) — Google rewards engagement.
- [ ] Also gather reviews on The Dyrt / Campendium / Hipcamp — they rank too.

---

## 4. The Echo (local newspaper) — your backlink + PR play

A link from a local news site is one of the strongest *local* relevance signals and is hard
for competitors to copy. Pitch a **story**, not an ad, and ask that the **online version link
to midwayplain.com**.

Angles to pitch (rotate seasonally):
- "Local family store adds RV & tent camping for the Leavenworth / Lake Wenatchee summer season"
- A community event "around the fire" at Midway
- A seasonal feature (opening weekend, fall colors in the Chiwawa valley, winter/Stevens Pass stop)

### Draft email to the Echo (for you to send — edit and send from your own address)

> **Subject:** Story idea — Midway adds RV & tent camping on Chiwawa Loop Road
>
> Hi [Editor name],
>
> I'm [your name] from Midway Gas & Grocery out on Chiwawa Loop Road in Plain. Alongside the
> store and 24/7 fuel, we've opened up full-hookup RV sites and tent camping for the summer —
> a little basecamp for folks heading to Leavenworth and Lake Wenatchee.
>
> I thought it might make a nice local piece — a working country store turning into a place to
> stay the night, what we're seeing from travelers this season, and what's new for locals. Happy
> to host a photographer; the sites and the valley look great this time of year.
>
> If it's a fit, could the online version link back to our site (midwayplain.com) so readers can
> find us? Thanks either way —
>
> [Name] · Midway Gas & Grocery · (509) 596-1076 · midwayplain.com

> Also check whether the Echo has a free **local business directory / "around town" listings** —
> get listed there too (another local citation + link).

---

## 5. Ongoing (monthly, ~30 min)

- [ ] Add fresh GBP photos + a seasonal Post.
- [ ] Ask that week's campers for reviews; reply to any new ones.
- [ ] Check Google Search Console for which queries you're appearing for; add copy/FAQs to the
      landing pages targeting the ones you're *almost* ranking for (positions 8–20).
- [ ] One local link per season (the Echo, a Leavenworth tourism site, a partner business).

---

## Priority order (if you only do a few things)
1. Google Business Profile: verify + add Campground/RV park categories + photos. *(Section 1)*
2. Turn on review collection (QR at the register). *(Section 3)*
3. List on The Dyrt, Campendium, Hipcamp, Good Sam. *(Section 2)*
4. Pitch the Echo. *(Section 4)*
5. Send me the GA4 Measurement ID so we can measure all of it. *(Section 0)*
