# UI System

## Design Goal

MidwayOS should feel polished, local, simple, and durable.

The public site should feel like a stylish family-owned mountain store, not a generic gas station template. The admin should feel like a practical phone app.

## Brand Direction

Known:

- Business: Midway
- Location: Plain, Washington
- Logo: black and white
- Tone: polished, local, family-owned, quaint farmhouse

Visual mood:

- Clean farmhouse.
- Mountain store.
- Useful and warm.
- Not overly rustic.
- Not cluttered.

## Theme Tokens

Use tokens for:

- Colors
- Type
- Spacing
- Border radius
- Shadows
- Z-index
- Layout widths

Example token groups:

```css
:root {
  --color-ink: #1f1f1d;
  --color-paper: #faf8f2;
  --color-cream: #f2eadc;
  --color-sage: #6f7f68;
  --color-barn: #8d2f22;
  --color-steel: #596063;
  --color-line: #ded6c8;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  --radius-sm: 4px;
  --radius-md: 8px;
}
```

Avoid making the whole site beige/brown. Use natural accents with enough contrast.

## Public Site Layout

Recommended sections:

- Header
- Hero
- What we carry
- RV sites/property map
- Location/area
- Instagram
- Hours/contact
- Footer

Rules:

- The brand must be visible in the first viewport.
- Primary CTAs: Book RV Site, Call, Directions.
- Text should be short.
- Use real images when available.
- Use fallback UI for external embeds.
- Keep the public site single-page for MVP.

## Admin Layout

Mobile-first admin navigation:

- Today
- RV
- Inventory
- Sales
- Content
- AI
- Settings

Admin UI rules:

- Big tap targets.
- Short forms.
- Bottom sheets for detail views.
- Clear save/cancel.
- Confirm risky actions.
- Show sync status for Square.
- Show who changed what when it matters.

## Map UI

Customer map:

- Available
- Selected
- Booked
- Blocked
- Not available for selected dates

Admin map:

- Available
- Occupied
- Arriving
- Departing
- Blocked
- Maintenance
- Payment issue

## Reusable UI for Future Businesses

Keep UI flexible through:

- Brand tokens.
- Configurable public sections.
- Generic bookable asset model where possible.
- Replaceable map data.
- Replaceable service/category lists.

