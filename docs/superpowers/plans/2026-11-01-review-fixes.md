# Review Fixes Implementation Plan

> Execute tasks with independent parallel domains where files do not overlap, then integrate and review the complete branch.

**Goal:** Resolve all eleven findings in the project review.
**Architecture:** Focused helpers for session revocation, ledger transactions and progress storage; retain the current server and HTTP contracts. A common transaction lock prevents financial write skew across instances.
**Tech Stack:** Node.js 22.13+, Express, Socket.IO, MongoDB replica set, PDF.js, Chromium.
**Spec:** `docs/superpowers/specs/2026-11-01-review-fixes-design.md`.

## Global constraints
- No production changes, deployment, data deletion or forced account resets.
- Preserve existing API response formats and user workflows.
- Every invalid annotation payload must be rejected without terminating a process.
- Financial mutations and imports are atomic across app instances; no unsafe fallback.
- Existing legacy bootstrap credentials require an explicit documented rotation path.

## Review focus
- Credential expiry while a socket remains connected, including silent read-only recipients.
- Membership, role and password changes while events are queued.
- Concurrent financial writes and duplicate imports on multiple database clients.
- Shared browser account switching and failed progress fetches.
- Archive file references during material changes/deletion.

## Task 1: PDF loading and dependency fixes
- [x] Add regression checks for patched PDF options and same API/worker on all three pages; observe failures.
- [x] Use a common PDF loader with a patched dependency, disable eval in both loading paths, update pages and worker.
- [x] Test loading a real PDF in Chromium, including observer; preserve target browser compatibility where feasible.

## Task 2: Session version and secure administrator bootstrap
- [x] Add failing tests for password-reset revocation and bootstrap behavior.
- [x] Implement session versions, strict token purposes, unique bootstrap credentials and password rotation tooling.
- [x] Integrate reset/logout invalidation and administrator password changes into server; document legacy migration.

## Task 3: Ledger transactions
- [x] Write failing concurrent-transfer and atomic-import tests against an ephemeral replica set.
- [x] Implement `createPaymentLedger({client, lockCollection, accounts, entries, users})` with common write lock and transactional mutation methods.
- [x] Route all deposits/allocations/lesson mutations and imports through the service; preserve errors and responses.
- [x] Verify concurrent operations never overspend and failed imports roll back fully.

## Task 4: Per-account game progress
- [x] Add failing shared-browser tests showing state must not cross accounts.
- [x] Scope local progress by authenticated user and avoid unowned legacy migration.
- [x] Verify save/reload, offline fallback and account switching.

## Task 5: Annotation boundary and ownership
- [x] Test null/malformed points and arbitrary event payloads; observe failures.
- [x] Harden validators and event boundaries, enforce student userId and current-document scope for delete/erase/undo.
- [x] Verify teacher correction still works and invalid payloads do not terminate Socket.IO.

## Task 6: Live access revocation
- [x] Add tests for archive/deactivation/membership changes, expired tokens and password reset during a connection.
- [x] Revalidate socket events; disconnect revoked recipients and periodically revalidate passive sockets.
- [x] Wire immediate local revocation to account/lesson mutations and logout; retain cross-instance periodic protection.

## Task 7: Private documents and archive retention
- [x] Add failing tests for private PDF headers and archived material references.
- [x] Set `Cache-Control: private, no-store` on document responses; forbid deleting materials referenced by any lesson or current-document setting.
- [x] Verify archive files remain downloadable and unused materials can still be deleted.

## Task 8: Integration and verification
- [x] Add lock file, update vulnerable direct upload dependency if compatible, document setup and deployment prerequisites.
- [x] Run Node suite, replica-set integration tests and relevant HTTP browser tests; report environment-related failures precisely.
- [x] Review the complete diff independently, resolve material feedback, then provide branch/commit and a reviewable PR when tooling permits.

## Execution record
- Baseline: main `f687d06912941fb6163f9df7c3acf353a8cb5079`; dedicated local clone, no user changes. Working branch `fix/review-security-and-data-integrity`.
- User authorization: “Можешь починить все находки?” explicitly covers the eleven review fixes; no additional product discovery is needed.

- Ruling: final npm audit identified CVE-2026-16633 in the last Node20-compatible PDF.js5.6.205. Use patched6.5.438 and Node22.13+ in package, Docker and CI; do not keep a known-vulnerable compatibility branch.

- Verification: real MongoDB integration36/36; isolated game-progress/adventure HTTP browser suites green; patched PDF6.5.438 six real browser role/loading cases green, including missing native Promise.withResolvers in main and worker realms.
- Independent review: fixed packet reordering, handshake-expiry timer leak and cross-account POST race. Final review reported no remaining Important/Critical issues; unknown-outcome payment keys intentionally survive only the current page lifetime.
- Environment limits: physical Huawei and cross-device media were not tested; original file:// browser fixtures are blocked by managed Chromium policy and prior RTC media fixture timed out. New regression browser tests use HTTP.
