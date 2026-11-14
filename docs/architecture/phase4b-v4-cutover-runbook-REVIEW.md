# Phase 4B v4 — completion RPC cutover: review-only runbook

**Status:** candidate, NOT a migration; nothing in this package writes to staging or production. Base local commit: `10bc92bdb1bfb23da90ad87de228bf05168dc5f8`.

## Why cutover is needed

The older `public.complete_learning_session(uuid,jsonb)` RPC is currently callable by `authenticated` and returns results without scheduling reviews. Moreover, `authenticated` has an `INSERT` grant on `public.learning_results`, so a caller with a JWT may fabricate its own completion-ledger row without using either completion RPC. An owner-only RLS insert policy does **not** prevent that. The v4 SQL candidate revokes both routes to bypass the new review scheduling.

## Local acceptance

Run `bun test backend/tests/phase4b-v4-cutover-pglite.test.ts` in the Smart Plan working tree. It provisions a fresh in-memory PGlite Postgres, loads the baseline migration history and v3 SQL **only inside that process**, applies this candidate there, and tests old-RPC denial, ledger-write denial, service-only v3 completion, and ongoing user session saves.

PGlite tests verify permissions and transaction behavior on one isolated database instance. They **do not prove** a race between two independent real PostgreSQL connections. That is a required additional gate.

## Deployment gates — do not execute during local development

1. Resolve the **separate unresolved integrity issue**: `authenticated` still has direct `INSERT`/`UPDATE` on `public.learning_sessions` because `save_learning_session` is currently a `SECURITY INVOKER` RPC. A direct client can potentially alter an unfinished snapshot without following the backend's revision/assessment checks. Moving session writes behind a privileged writer or a thoroughly reviewed tightly scoped RPC is a production blocker. Audit other progress-table grants too.
2. Verify the exact SQL function bodies, execution privileges, RLS policies, table grants and migration versions in *staging* with read-only SQL. Review any app workflows still using `complete_learning_session` directly from the client.
3. Create a disposable multi-connection PostgreSQL test and prove two simultaneous v3 completions for the same session result in exactly one result row and one review transition; also test different sessions racing on the same words. PGlite's single in-process connection is not sufficient evidence.
4. Prepare a coordinated maintenance window. Stop or block completion traffic. Install and verify the v3 function, apply the cutover revokes **before** reopening traffic, and configure the backend to use `REVIEW_WRITE_V3_ENABLED=true` with the server-only secret. There can be a brief failure-closed interval during this handoff. Never leave old completion permissions available while advertising v3 as authoritative.
5. Verify with two real staging accounts: `authenticated`/`anon` cannot execute either privileged v3 or legacy completion, `authenticated` cannot insert `learning_results`, owner can save an unfinished session, service-only v3 completion works, and replay is idempotent. Review logs, backup and rollback plan, and explicit approval before repeating in production.

**Rollback caveat:** turning the backend flag off *after revoking legacy completion permissions* makes completion fail closed. Re-granting the old RPC or ledger inserts reintroduces the bypass. Pause completion and fix forward rather than automatically reverting grants. No SQL in this candidate should be installed automatically in a migration runner.
