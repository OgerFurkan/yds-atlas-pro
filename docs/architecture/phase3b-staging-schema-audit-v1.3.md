# Phase 3B v1.3 — Local database draft audit (NOT a migration)

**Status: security review in progress; NOT APPROVED FOR STAGING OR PRODUCTION.**

The existing `supabase/sql/learning_foundation_draft.sql` is evaluated only inside an **isolated, in-memory PGlite database**. No migration is added to `supabase/migrations`; no remote or local Supabase project is connected or modified. The existing 7-table baseline is applied first, followed by the proposal in memory.

## What the tests prove

- The draft creates two new RLS-enabled tables (`daily_plan_states`, `word_review_schedules`) on top of the existing seven.
- `anon` has no SELECT privilege on either new table.
- The daily-plan SELECT/UPDATE policies restrict rows to their owner.
- The review schedule composite FK prevents an owner from referencing another owner's `words` row; numeric constraints and `ON DELETE CASCADE` behave as intended.

## BLOCKERS — intentionally demonstrated by two green characterization tests

A test that **proves a vulnerability exists** is not a test that **certifies security**. The following tests are expected to pass **because the current draft is insufficient**:

1. `KNOWN GAP: authenticated direct UPDATE bypasses backend revision checks`. The draft grants `UPDATE` to `authenticated` on `public.daily_plan_states`. RLS checks row ownership but does not enforce the backend's `expectedRevision` compare-and-swap contract. A signed-in user can call the Data API directly and set an arbitrary revision or overwrite their own plan. The backend's GET/PUT validation alone does not close this path.
2. `KNOWN GAP: direct plan INSERT can include a different account's word ID`. The `payload jsonb` constraint checks only that it is an object. RLS checks `user_id`, not word IDs nested in the JSON. Direct Data API calls can therefore store unauthorized/stale IDs in the JSON payload, even though `saveDailyPlan` rejects them on the supported backend route.

**DO NOT merge/deploy this SQL draft** on the strength of these passing tests. Tests for *denying* the two behaviors must replace characterization tests before migration approval.

## Decision for v1.4

Choose an atomic, account-bound write boundary enforced **in Postgres**, not just by the Bun API. Candidate design:

- Keep owner-scoped RLS + `SELECT` for supported reads.
- Remove direct `INSERT`/`UPDATE` on daily-plan state from ordinary authenticated client roles.
- Add an explicitly granted, fully reviewed database function for CAS writes; it must authenticate the owner, validate the complete snapshot and nested word ownership, protect all writes in one transaction, and reject stale revisions. A privileged function requires careful ownership, search-path and EXECUTE grant review. Avoid casually adding a `SECURITY DEFINER` function in `public`.
- Update Bun `saveDailyPlan` to call that boundary through the caller's verified JWT, not with a browser secret or an unguarded `service_role` client.
- Add tests that attempt direct table writes as `anon` and `authenticated`, verify owner isolation, stale revisions, invalid/foreign IDs and first-write races. New tests should reject all forbidden writes, including after a valid update.
- Once the hardened contract passes locally, use `bunx supabase migration new <name>` (after checking CLI `--help`) to generate an official migration file; then validate a **separate staging environment** and Supabase advisors. Do not apply to the active `yds-atlas-pro` project without explicit permission.

### Design caveats

The proposed review schedule table has `INSERT`/`UPDATE`/`DELETE` privileges for `authenticated`, so clients can directly change their own review progress. Decide whether SRS outcomes are user-editable or trusted only after a completed learning session. If trust matters, use a similarly controlled write boundary for schedules.

No live Supabase credentials, deployment or API requests are used in v1.3. The existing 5 + 5 + 5 + 5 + 20 learning flow and all open PRs remain untouched.

References: Supabase RLS docs (`https://supabase.com/docs/guides/database/postgres/row-level-security`) and Data API security (`https://supabase.com/docs/guides/api/securing-your-api`).
