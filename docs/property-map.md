# Property Map Data Workflow

Midway should keep the public RV map as a custom illustrated SVG or HTML/CSS map backed by structured site data. The source data lives in `src/lib/rv-map-data.js` with normalized coordinates so the same layout can scale across the public booking flow and future admin map.

## Recommended Real Map Workflow

1. Get a real reference image from the owner: a current drone image, owner-provided aerial photo, site survey, or licensed aerial imagery.
2. Confirm the numbered RV site list with the owner, including max rig length, amp service, pull-through/back-in type, shade, amenities, SKUs, and customer-facing notes.
3. Trace the property in a vector editor as an SVG layer: roads, store/fuel landmarks, trees, the center island, and the 14 RV site regions.
4. Keep each RV site region tied to its stable site number and data ID, for example `rv-03`.
5. Store each site's center point and tappable region dimensions as normalized `0..1` coordinates, not fixed pixels.
6. Export the clean SVG/background art separately from the data module so site availability can be rendered dynamically.
7. Re-check the rendered public map at mobile and desktop sizes before replacing the current hardcoded fallback map.

## Licensing And Attribution

Do not trace or publish Google Maps, Google Earth, or other third-party map imagery unless the license explicitly allows the intended use and the required attribution is preserved. Use owner-provided imagery, original drone photography, survey drawings, or properly licensed aerial references for production artwork. Google imagery can be useful for internal orientation, but it should not become the production source of the illustrated map without legal review.

## Data Contract

Each RV site should include:

- Stable `id` and unique `siteNumber`
- Normalized `mapX`, `mapY`, `mapWidth`, and `mapHeight`
- `rotation` for angled SVG rendering
- `amenities`, `maxRvLengthFeet`, `amp`, `type`, `shade`, and `sku`
- Customer notes and private admin notes

The current normalized coordinates are based on the owner-supplied aerial reference, with RV sites `03-10` on the right row and `11-16` on the left row. They should be tightened again if a current survey, drone image, or production-safe aerial source becomes available.
