# Frontend Platform

## Goal

MidwayOS public frontends should look incredible and feel custom, without requiring custom forks for every business.

The platform should support dynamic frontends through:

- theme skins
- section composition
- content config
- business profiles
- visual assets
- feature flags
- reusable modules

## Principle

The frontend should feel bespoke. The code should stay shared.

## Frontend Layers

### Core Rendering Layer

Responsible for:

- layout engine
- section rendering
- theme tokens
- responsive behavior
- SEO metadata
- analytics/events
- accessibility

### Section Library

Reusable sections:

- hero
- services
- booking map
- product highlights
- location
- hours/contact
- Instagram
- gallery
- announcements
- FAQ
- events
- testimonials
- local area guide

### Theme Skins

Skins control:

- color palette
- typography
- button style
- section spacing
- image treatment
- texture/pattern use
- animation style
- card/list treatment

Initial skins:

- `midway_farmhouse`
- `mountain_market`
- `clean_cstore`
- `rv_campground`
- `local_grocery`

### Business Profile Presets

Profiles set sensible defaults:

- `convenience_store_rv`
- `gas_station_market`
- `campground_store`
- `bait_tackle_shop`
- `cafe_market`
- `local_retail`

Each profile configures:

- enabled features
- default sections
- SEO defaults
- dashboard modules
- provider suggestions
- theme recommendations

## Section Config

Example:

```json
{
  "theme": "midway_farmhouse",
  "sections": [
    { "type": "hero", "variant": "image_full_bleed" },
    { "type": "services", "variant": "icon_grid" },
    { "type": "rv_map", "variant": "interactive_property" },
    { "type": "location", "variant": "map_split" },
    { "type": "instagram", "variant": "embed_with_fallback" },
    { "type": "hours_contact", "variant": "compact" }
  ]
}
```

## Design Quality Rules

- Use real photography wherever possible.
- Make the business name/logo a first-viewport signal.
- Avoid generic SaaS/stock-template layouts.
- Keep hero sections immersive and visual.
- Make primary actions obvious.
- Keep mobile beautiful, not merely functional.
- Keep text short and local.
- Use motion sparingly.
- Never let embedded widgets break layout.
- Always provide fallbacks for Instagram/maps/providers.

## Dynamic Visual System

The platform should support:

- full-bleed hero images
- section-level image art direction
- responsive crops
- image focal points
- seasonal visual swaps
- announcement banners
- dynamic service highlights
- location-specific content

## Admin Editing

Tenant/platform admin should be able to edit:

- theme skin
- section order
- section visibility
- hero image
- logo
- colors within guardrails
- services list
- hours/contact
- local SEO copy
- booking CTA labels

Guardrails:

- no arbitrary CSS in MVP
- curated theme tokens
- validated color contrast
- preview before publish
- rollback to last published version

## Tenant Editing Modes

Tenants should be able to manage their frontend through multiple safe entry points.

### Visual Editor

Best for:

- changing section order
- hiding/showing sections
- swapping photos
- editing text
- choosing theme skin
- previewing before publish

Editor requirements:

- mobile-friendly
- preview/publish workflow
- draft autosave
- rollback
- no arbitrary CSS in MVP
- contrast/accessibility checks
- broken embed fallback warnings

### AI Editor

Best for:

- "Make the RV section more focused on families."
- "Add a weekend firewood announcement."
- "Update the homepage for winter visitors."
- "Rewrite the bait and tackle section for Lake Wenatchee fishing."

AI editing rules:

- AI writes to draft only by default.
- AI must show proposed changes before publish.
- AI must cite which sections it changed.
- AI cannot remove required legal/contact/booking/payment information.
- AI cannot publish high-impact changes without authorized approval.

### MCP Editing

Best for:

- agent-driven updates
- bulk section changes
- scheduled seasonal swaps
- cross-location changes
- external automation

MCP editing tools should include:

- `get_frontend_config`
- `create_frontend_draft`
- `update_frontend_section`
- `reorder_frontend_sections`
- `set_theme_skin`
- `validate_frontend_draft`
- `preview_frontend_draft`
- `publish_frontend_draft`
- `rollback_frontend_publish`

Risk levels:

- Low: read config, validate draft, preview draft.
- Medium: edit text, reorder sections, swap image.
- High: publish, rollback, change theme, remove booking section, change SEO-critical content.

## Draft/Preview/Publish

Frontend changes should follow this flow:

1. Tenant edits through visual editor, AI, or MCP.
2. Changes are saved to draft config.
3. System validates:
   - required sections
   - enabled feature flags
   - contrast
   - broken links
   - provider/embed fallbacks
   - mobile layout smoke
4. Tenant previews draft.
5. Tenant publishes.
6. Published config is versioned.
7. Rollback remains available.

## Content Versioning

Every publish should store:

- version id
- tenant id
- location id
- editor type: user, AI, MCP, system
- published by
- diff summary
- previous config
- published config
- timestamp

## Required Section Protection

Some sections may be required based on enabled features:

- booking enabled requires booking CTA/section
- payments enabled requires checkout terms/link copy
- location enabled requires address/directions
- contact enabled requires phone or contact method
- local SEO enabled requires core NAP data

Tenants can restyle or move required sections, but should not remove them without disabling the related feature.

## Frontend Testing

Every public frontend skin needs:

- desktop screenshot baseline
- mobile screenshot baseline
- section visibility tests
- feature flag tests
- accessibility smoke checks
- provider fallback tests

## Avoiding Overcomplication

Do not build a drag-and-drop page builder first.

Start with:

- curated sections
- curated variants
- theme tokens
- config-driven ordering
- preview/publish

That gives 80% of the flexibility with 20% of the complexity.
