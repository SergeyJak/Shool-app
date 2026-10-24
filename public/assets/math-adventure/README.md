# School App · Math Adventure visual pack

Complete **starter asset set for the first forest chapter**. Assets are separate editable SVG files, with transparent character and UI elements.

## Contents
- `backgrounds/` 8 illustrated SVG scenes (forest, river, meadow, castle, mountains, sunset, cave, boss arena).
- `characters/` owl (three variations including existing mascot) and dragon boss.
- `map/` winding road, branch sign, available/complete/current/locked/challenge/boss nodes.
- `ui/` button, progress bar, card, speech bubble.
- `icons/` star, subject icons, check/back/next/close.
- `references/` original AI concept and eight cropped screen examples.
- `examples/map-preview.html` working standalone clickable map preview; open locally in browser.
- `manifest.json` inventory for integration.

## Integration
Copy `backgrounds`, `characters`, `map`, `ui`, and `icons` to `public/assets/math-adventure/` in Shool-app. All are standalone SVG and can be scaled without loss. Keep map interactions as HTML buttons above backgrounds; do not use flattened reference images as UI.

## Scope
This is an asset kit, **not a completed game**. Diagnosis logic, branching progression, skill mastery, storage, and server integration require code. Art is an original vector interpretation, not a pixel-identical extraction of the generated concept.
