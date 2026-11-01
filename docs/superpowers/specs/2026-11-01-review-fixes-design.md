# Review fixes

Implement the eleven findings in `docs/reviews/2026-11-01-project-review.md`, as requested by the user. Keep Express, Socket.IO, MongoDB and existing product workflows. Do not modify production data, deploy, or merge as part of implementation.

Use coordinated, focused fixes rather than restructuring the whole application. PDF pages share one patched API/worker version and disable eval. All annotation inputs must tolerate arbitrary JSON; students can mutate only their own annotations in the current document. Active sockets must lose access on account/session/membership/lesson revocation, and expired credentials must not continue receiving room events. Account password changes increment a session version; initial administrators use unique configured credentials with a documented migration for legacy installations. Existing non-legacy accounts remain intact.

Financial writes use MongoDB transactions and a common ledger document updated inside every transaction before reading balances. This serializes allocation, consumption, rollback and imports across processes and avoids snapshot write skew. Unsupported standalone MongoDB must fail safely, without nontransactional fallback. Imports are atomic. Preserve existing response/error contracts.

Authenticated PDF responses are not publicly cacheable. Material deletion preserves all referenced archive documents. Game progress keys include the account identifier; another account's local state is never merged into the current account. Offline data belongs to its recorded user.

Alternatives considered: process-local locks cannot coordinate replicas and were rejected; a complete architecture rewrite adds unrelated risk and was rejected; resetting all users/data would be destructive and was rejected. Scope and behavior follow the review recommendations the user authorized. Routine implementation choices are delegated to the implementer.

Verification: regression tests reproduce each original failure before implementation, then pass; existing Node tests remain passing. Use an ephemeral MongoDB replica set for financial concurrency/rollback tests and local HTTP browser fixtures for real PDF loading and account switching. Record any environment limits. Keep production credentials and data out of tests.

Implementation ruling: a final dependency audit also found CVE-2026-16633 in PDF.js5.6.205. The final implementation pins6.5.438 and requires Node22.13+; Docker and CI use Node22. A small feature-detected Promise.withResolvers shim runs before PDF API and worker initialization to preserve that legacy-browser API compatibility without retaining a vulnerable PDF.js version.
