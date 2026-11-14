# Phase 3B v1.5 — server-only daily plan writer (pre-staging)

## Status

**NOT DEPLOYABLE / NOT AN OFFICIAL MIGRATION.** The candidate v1.4 SQL from `supabase/sql/` remains un-applied. This patch changes only the Bun API writer boundary and adds backend contract tests. **Do not deploy API and SQL independently.** The existing preview UI performs GET only; this patch does not activate sync or expose a Save button.

## Trust boundaries

- The existing Bun `authenticate()` validates a bearer token with `supabase.auth.getUser()` and rejects anonymous sessions. The verified `ctx.userId` is the only owner source. `x-user-id`, a JSON `user_id`, or other client-owner fields are ignored/rejected.
- The JWT-scoped `ctx.db` continues to read the plan and validate word ownership. It must never INSERT or UPDATE `daily_plan_states` after the hardened SQL is applied.
- A distinct `dailyPlanWriterClient(config)` is instantiated **inside the Bun process** only for the explicit authenticated PUT route. It uses `SUPABASE_SECRET_KEY` without a caller Authorization header. Missing key fails closed with `503 DAILY_PLAN_WRITER_NOT_CONFIGURED`.
- `saveDailyPlan` requires an explicit `writer` parameter; no fallback to a user-scoped write client exists. INSERT uses verified `ctx.userId`; UPDATE matches **both** `user_id` and `expectedRevision`, and stale writers receive `409 DAILY_PLAN_CONFLICT`.
- The SQL candidate's `SECURITY INVOKER` trigger additionally validates plan word ownership, structural validity, owner immutability and revision increments; the backend's earlier word lookup is a UX optimization, not the only security control.

## Test and deployment requirements

Run `bun run test:api` (new `daily-plan-writer-boundary.test.ts`), `bun run test:unit`, `bun run build`, `bun run lint`, `bun run test:cloud`, and `bun run test:e2e`. Keep v1.3's vulnerable-draft characterization tests to prevent accidental misinterpretation.

**Before staging:** audit privileged-client key handling, evaluate direct service-role use vs. a narrowly scoped server-only DB function, confirm no secrets enter frontend bundles/logs, and verify authenticated GET/PUT, revision races, cross-account isolation, and concurrent word deletion using real staging Postgres, not only mocks/PGlite. Only then create an official migration via Supabase CLI. Do not change the live YDS Atlas Pro Supabase project.

No automatic device sync, no localStorage mutation, no user data overwrite, no changes to 5+5+5+5+20 learning.
