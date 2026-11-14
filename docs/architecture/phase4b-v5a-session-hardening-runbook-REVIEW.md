# Phase 4B v5A — server-only session save boundary (review candidate)

**Base local commit:** `1d8a9c4c25b8b1c68aa1d9ba361c780bbfa85529`. No staging/production mutation, no auto-migration, no deployment, no feature flag toggling.

## Confirmed risk

At the time of the read-only staging inspection, `authenticated` had direct `INSERT` and `UPDATE` on `public.learning_sessions`, and could execute `public.save_learning_session(uuid,jsonb,integer)`. The SQL function is an invoker and does only a limited snapshot validation. A caller with its own JWT can replace the **unfinished** session's `snapshot`, bypassing the backend `gameSessionSchema` validation. RLS restricts account scope but does not enforce the game's rules or prevent forged within-account assessments. `public.complete_learning_session_v3` rechecks submitted ratings against the *stored snapshot*, but cannot independently know if a client fabricated that snapshot. Eliminating direct table writes is necessary, but not a guarantee that the user's answers themselves were genuine.

## Local acceptance (no remote DB)

`bun test backend/tests/phase4b-v5a-session-hardening-pglite.test.ts` provisions a fresh disposable PGlite. It first demonstrates the original direct update bypass; then installs the proposed service-only session writer **inside that disposable database**, runs the revocation overlay, and asserts direct client writes and old RPC are denied while user reads and privileged revision-CAS saves still work.

## Three-stage rollout (not authorized yet)

1. **Application code** — implement an independently reviewed backend `saveSession` path using `authenticate()` and `gameSessionSchema.parse(...)`, then the secret-key writer. Make this path opt-in, default OFF. Add contract tests; do not send `p_owner_id` from the browser.
2. **Coordinated DB cutover** — stop completion and session-save traffic; verify the exact staging ACLs and migration state, install the v3 completion writer + v4 legacy completion cutover and the v5 session writer + cutover atomically or under a carefully managed maintenance window. Only reopen traffic once the backend is configured for both privileged writers. Old clients must be expected to fail closed.
3. **Staging acceptance and rollback** — two independent real Postgres connections must race on the same session and different sessions sharing words. Verify exactly-once result/schedule, CAS, deadlocks/timeouts, user isolation, JWT owner reads and no direct write permissions. Rollback should pause traffic and fix forward; restoring the direct grants reopens bypass paths.

## Explicit further blockers

- `authenticated` also had direct `UPDATE` access to `public.words`, `INSERT` to `public.daily_word_completions` and `completed_goal_days`. These can forge parts of learning history independently. Audit and redesign their writes before asserting *all progress* is trustworthy; avoid simply revoking rights needed by existing invoker RPCs without replacements.
- The existing frontend/backend completion path and session-save path must both be cut over before revoking old permissions. The v3 and v4 candidates in Git **are not yet applied to staging**.
- PGlite uses one in-process database connection; these tests do **not** prove concurrent transactions across two independent PostgreSQL sessions. That needs a separate real-Postgres test (v5B).
- The app can validate format and state but cannot cryptographically prove a human remembered a word rather than submitting fabricated answers. Strong anti-cheat would require a server-controlled challenge/answer protocol; that is outside this phase.
