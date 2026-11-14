# Phase 3B v1.4 — database boundary candidate (local tests only)

## Status

**NOT DEPLOYABLE / NOT AN OFFICIAL MIGRATION / NOT PRODUCTION-READY.**
This is a staged, local-only candidate that lives under `supabase/sql/`, not `supabase/migrations/`. Never paste it into Supabase SQL Editor or run `db push` against a remote database. The previous Phase 3A draft remains unchanged. The current Bun `PUT /api/account/daily-plan` handler uses a JWT-scoped user client and would **lose write permission** if this SQL were deployed alone. Backend adaptation and real staging integration tests are required first.

## What it hardens

1. Supabase `authenticated` roles retain owner-only SELECT through RLS, but direct INSERT/UPDATE/DELETE is revoked on `daily_plan_states` and `word_review_schedules`; write policies for those roles are removed. In this model *only a trusted server* will write.
2. The dedicated `service_role` receives explicit table DML permissions for eventual server-only operations. This key must never be sent to the browser or placed in `VITE_` environment variables.
3. A `SECURITY INVOKER` trigger validates plan JSON structure, day bounds, unique word membership, and owner-scoped word existence, including `excludedWordIds`.
4. The trigger rejects first inserts with a revision other than 1, cross-owner reassignments, unchanged or jumping revisions. **The backend still must use `WHERE user_id = <authenticated id> AND revision = <expected revision>`** to handle stale-writer races; the trigger does not replace compare-and-swap.
5. Review-schedule ownership continues to use the existing composite `(user_id, word_id)` foreign key. Direct authenticated writes are disabled until a safe completed-session backend write path exists.

## Test approach

`backend/tests/phase3b-privilege-hardening.test.ts` builds a standalone in-memory PGlite database, applying the original foundation migration + the un-applied Phase 3A draft + this hardening candidate. It checks read-only RLS, rejects direct authenticated writes, validates foreign IDs, malformed assignments, duplicates, and stale revisions. Existing v1.3 characterization tests should *continue* passing because they deliberately load only the vulnerable, original draft to document its risks.

## Remaining before staging rollout

- Switch backend `saveDailyPlan` write operations from the user-scoped client to a dedicated server-only writer, with explicit `ctx.userId` binding and the existing word ownership checks retained. The current user-scoped client should continue handling read-only GET and word ownership checks.
- Add backend API integration tests for authenticated GET, PUT first save, matching revision PUT, conflicting/stale PUT, and two-account isolation with the secure SQL candidate. No browser-based direct DML.
- Confirm service-role secret storage and access constraints; verify no secrets in client bundles or logging.
- Convert the reviewed candidate into an official Supabase CLI migration ONLY after tests pass, then test it on a genuinely separate staging project/branch with backup, advisors, permissions and two accounts.
- Migration must be applied atomically with the backend writing change. Never deploy the read-only privilege restriction by itself: that would break PUT.
- Evaluate concurrent word deletion vs. plan saves: a deleted word must cause save to fail, not silently become a stale JSON reference. Trigger checks each word on every insert/update; add concurrent deletion tests on real Postgres staging.

## Regression protections

No production SQL, no Git operations, no app UI changes, no automatic sync, no data deletion and no impact on the 5+5+5+5+20 learning flow. Existing open PR #2/#3/#4 stay separate; Phase 3B remains stacked on Phase 3A.
