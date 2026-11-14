# Phase 4B v5C-C — Privileged daily goal and progress-ledger cutover CANDIDATE

**REVIEW ONLY. NO STAGING/PRODUCTION MIGRATION PERFORMED.**

Scope: one new backend feature flag `GOAL_WRITE_V6_ENABLED` (default `false`), additive service-only `set_daily_goal_v6`, and an isolated cutover rehearsal that revokes **progress-ledger** inserts. Existing app behavior is unchanged unless the feature flag is explicitly enabled in an environment that already has the RPC.

## Staging sequence (requires separate explicit approval)
1. Confirm backups, all deploy revisions and verified owner-scoped `GET /api/account`.
2. Install additive v3 completion, v5 session and v6 goal-writer SQL on staging. Verify `service_role`-only RPC grants and server-secret isolation.
3. Deploy server with `REVIEW_WRITE_V3_ENABLED=true`, `SESSION_SAVE_V5_ENABLED=true`, `GOAL_WRITE_V6_ENABLED=true`; require live *staging* authenticated full-flow smoke including save, complete, goal update and reload. Do not expose privileged keys to frontend.
4. During coordinated cutover, apply review-only `phase4b-v5cc-ledger-cutover-REVIEW-ONLY.sql` after verifying the guard. Existing legacy clients will fail closed if still in use.
5. Verify authenticated direct DML and old RPC calls fail; verified API flows still succeed; no cross-owner access.
6. Only after stability, generate an actual reviewed migration with Supabase CLI; production requires separate approval.

## Deliberate remaining gap — manual word groups vs verified outcomes
`public.words.score` is **user-editable** via INSERT/UPDATE, `import_words` and `apply_word_scores`; the frontend currently derives manual Hard/Review/Learned groups from this same numeric score. This cutover does NOT claim words.score as trusted evidence. Verified completion history is `learning_results` and day ledgers, and spaced repetition is in `word_review_schedules` (service-only writes). If the product requires separate unforgeable mastery, introduce a distinct `manual_group`/`manual_score` representation and a server-maintained verified mastery field and migrate the frontend, API, and existing data first. Until then do not call `words.score` tamper-proof. Do **not** simply revoke `UPDATE(words.score)`; existing UI would break, and a table-wide UPDATE grant overrides column-level revokes.

## Tests
- `bun test backend/tests/goal-writer-boundary.test.ts backend/tests/phase4b-v5cc-progress-ledger-cutover-pglite.test.ts`
- General: `bun test backend/tests frontend/tests/unit`, `bun run build`, `bun run lint`, frontend Playwright.
- Existing 9 `phase4b-v5cb-progress-write-baseline-pglite.test.ts` tests remain a PRE-CUTOVER fixture intentionally asserting old vulnerabilities. They are not evidence that post-cutover privileges are unsafe; the two suites use isolated PGlite databases.
- Real PostgreSQL 16 two-connection v5B test should be rerun before cutover.

No automated production changes, schema migrations, flag flips or push are performed by this candidate.
