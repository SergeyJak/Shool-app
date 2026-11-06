# Checkpoint alignment on every adventure map

The current five shared percentage positions are independent of the twelve different illustrations used by twenty chapters. Cover-cropping also changes the visible platforms across screen sizes. The user requested tidy checkpoint placement on every map.

Use a portrait stage with the artwork's native 852:1846 ratio, and manually chosen route/platform anchors for each illustration. Chapters reuse their illustration's anchors while retaining their own five level names and states. Put captions on the inward-facing free side. Position the current owl in nearby free space after layout and on resize, avoiding checkpoint badges and captions.

Retaining cover-cropping would need different transformed coordinates at every aspect ratio and would still hide parts of the path. Replacing the art with a generic path would discard the existing design. Preserve the complete illustration instead. On short/landscape screens allow vertical scrolling rather than shrinking the map into unreadable controls.

Keep game mechanics, progression, completed/locked states, chapter navigation and account binding intact. No new art or dependencies. Validate all twenty chapters at mobile, desktop and landscape sizes, each of the hundred owl positions, collisions/clipping, and real game entry/return. Inspect screenshots of all maps. Browser plugin unavailable; use the existing Puppeteer/Chromium fixture.

## Verification

- `npm run test:adventure-map`: twenty chapters at 360×800, 412×915, 1280×900, 320×568 and 844×390; full artwork ratio, stable anchors, no clipped/overlapping captions; all hundred owl positions retain the current checkpoint as nearest; game entry/return makes no progress writes.
- `npm test`: 339 passed. Existing `test:math-adventure` and `test:math-progress` passed. `test:adventure-levels` passed all 470 rounds.
- Mobile screenshots of every chapter and desktop map screenshots inspected. On short/landscape screens scrolling preserves readable controls and the complete route.
- Independent review caught an owl fallback appearing beside another checkpoint. A regression failed for chapter 2 before the fix; proximity and nearest-checkpoint bounds now keep the owl associated with its own level, using a compact owl when space is tight. The reviewer verified the fix through resizing.
- The existing all-games browser check now waits for the save acknowledgement after its account recheck, rather than assuming the UI is updated as soon as the POST response arrives.
