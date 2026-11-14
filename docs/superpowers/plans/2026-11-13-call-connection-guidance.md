# Call connection guidance implementation plan

**Goal:** Explain browser permissions and call progress to both participants.
**Architecture:** Extend the existing shared communication UI and authenticated Socket.IO handlers; retain the current media pipeline.
**Tech Stack:** Vanilla JS, CSS, Socket.IO, Node test, Puppeteer.
**Spec:** docs/superpowers/specs/2026-11-13-call-connection-guidance-design.md

## Tasks
- [x] Add failing browser assertions for pre-permission guidance, preparation notifications and a distinct connecting stage.
- [x] Add an integration test to integration/review-security.integration.cjs for rtc2:preparing routing and stale/cross-room/self/invalid state rejection.
- [x] In public/lesson-comms.mjs and .css show an incoming native dialog and an inline three-stage preparation card after answering; keep media messages outside video art and mark connected only on peer connection success.
- [x] In server.js validate and relay requesting/blocked preparation states only to the current caller; consume them in the caller UI without altering accepted calls.
- [x] Run focused browser/integration and unit checks, inspect mobile screenshots, update client cache versions and publish the tested tree as a draft PR.

## Review focus
Permission pending and refusal remain actionable. Cancelling before permission resolves stops late tracks. Notifications cannot affect another room or later call. Receiving tracks before ICE connection cannot show success. At 320px, instructions and answer/cancel controls remain readable.
