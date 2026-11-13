# Learning foundation / Phase 3A

This change is deliberately non-disruptive. It does **not** enable cloud sync in the UI, change current storage, call AI, or run SQL on a production database.

## Delivered

- `dailyPlanSnapshotSchema`: strict 60-day, 40-word/day, one-owner model; exclusions and assignments cannot overlap.
- `GET /api/account/daily-plan` and `PUT /api/account/daily-plan`: JWT-authenticated, owner-bound, revision-based optimistic concurrency. The server verifies each word exists under the current account before saving.
- `loadCloudDailyPlan` and `saveCloudDailyPlan`: account-bound frontend transport, not yet connected to the UI.
- Pure SRS-style interval scheduler (`newReviewSchedule`, `rateReview`, `dueReviews`), with unit tests. This is an original simple scheduler; do not advertise it as FSRS/SM-2.
- Draft SQL for `daily_plan_states` and `word_review_schedules`, including RLS and an account-bound composite FK. **Never run it directly on production as a blind copy/paste.**

## Deployment order (future PRs)

1. Back up the existing Supabase database; create a staging environment/branch.
2. Use `bunx supabase migration new atlas_learning_foundation` to create an official migration, then paste and test `supabase/sql/learning_foundation_draft.sql` there. Add RLS tests and use Supabase advisors.
3. Deploy the new backend and verify authenticated GET/PUT plus 409 conflicts on staging, using two different accounts.
4. Integrate the existing local 60-day planner with the API behind a disabled-by-default rollout flag. **Do not silently overwrite any existing browser assignments.** First-device migration must preserve a local backup and keep the server revision.
5. Connect SRS result recording to completed learning sessions only; do not infer successful recall merely from reading flashcards. Build the "Today to review" queue and offline conflict UX.
6. Release in small cohorts and monitor storage, API errors and Gemini usage. Only then activate the feature for the 3 current users.

## Conflict rules

The first successful save uses expectedRevision=0 (INSERT). Every subsequent save uses an equal-revision conditional UPDATE; stale writers receive 409 (`DAILY_PLAN_CONFLICT`). Clients must reload or explicitly resolve a conflict, never auto-overwrite another device's work.

## Security

No browser secret keys, no service-role authorization shortcut, no client-supplied owner ID. RLS checks current JWT auth.uid(). Any word ID appearing in the payload must exist among the user's words. JSON snapshots and schedule rows are per-account.
