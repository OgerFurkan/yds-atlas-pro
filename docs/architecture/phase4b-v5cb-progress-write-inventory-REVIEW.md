# Phase 4B v5C-B — Progress write exposure inventory (REVIEW ONLY)

**Status:** isolated PGlite characterization; no deployment, migrations, permission changes, feature switches or Git actions. Base commit: `d3e4a3bac7e40b7bd04c3ea1e33393001015b5a1`.

## Confirmed from the supplied source and current migration history

| Entry point | Current capability / coupling | Implication |
| --- | --- | --- |
| `public.words` | `authenticated` SELECT/INSERT/UPDATE/DELETE with owner RLS; `score` included in INSERT and UPDATE | A user can assign arbitrary score to their own word; other users remain isolated |
| `public.import_words(jsonb)` | `SECURITY INVOKER`; inserts supplied `score` | Revoking authenticated `words` INSERT alone breaks bulk import; existing RPC can assign arbitrary initial score |
| `public.apply_word_scores(jsonb)` | `SECURITY INVOKER`; callable by authenticated | A user can set scores without a completed game, directly through Data API RPC |
| `PUT /api/words/scores` | accepts user-supplied IDs and `score` values (0–100), invokes `apply_word_scores` using user JWT | Backend route itself currently accepts manual mastery overrides; DB permissions alone cannot enforce game-evidence-only scores |
| `POST /api/words`, `PUT /api/words/:id` | `saveWord` writes `score` from `wordInputSchema`, and `content` duplicates it | Restricting score UPDATE will break editing unless code and schema contract change together |
| `public.daily_word_completions` | authenticated INSERT, owner RLS, no word FK | Owners can insert fabricated daily word completions even without game results |
| `public.completed_goal_days` | authenticated INSERT, owner RLS | Owners can insert fabricated goal milestones |
| `public.set_daily_goal(integer)` | `SECURITY INVOKER`; also INSERTs `completed_goal_days` when threshold met | Revoking milestone INSERT breaks legitimate goal adjustment until RPC is migrated |
| `public.complete_learning_session(uuid,jsonb)` | legacy authenticated invoker, needs words UPDATE, ledger INSERT, progress INSERT, sessions UPDATE | Revoke ONLY after v3 server writer is deployed/verified; privileges are coupled |
| `public.complete_learning_session_v3` | service-only REVIEW-ONLY SQL, tested in isolated DB | Atomic score/SRS/progress writer is ready for staged migration, not yet applied in staging |
| `public.save_learning_session_v5` | service-only REVIEW-ONLY SQL | Session save v5C-A backend flag is OFF by default; do not revoke old save rights yet |

## Required design decisions before the breaking cutover

1. Determine whether **manual mastery adjustments** (`/api/words/scores`, drag-and-drop grouping, imports, edits) are intentional product functionality. If they are, preserve them via a separate, auditable manual override pathway and DO NOT label manual scores as game-earned evidence. If not, remove/retire that pathway and update UI first.
2. Change word creation/editing/import to avoid accepting client-provided game-earned scores. Preserve legitimate profile/content edits; decide how existing imported score values migrate. Separate `words.score` from editable content if needed.
3. Switch completion to the already tested server-only v3 RPC and session save to v5, after the additive SQL functions have been applied to a disposable and then controlled staging DB; feature flags remain OFF beforehand.
4. Replace `set_daily_goal` with a safe server writer or a security-invoker-compatible design for milestone creation; protect `daily_word_completions`, `completed_goal_days` against direct user INSERT. Include `learning_results`/session cutover from v4/v5A.
5. Verify role grants **and** owner RLS with two accounts; test direct REST/DML and RPC bypass, legitimate word CRUD, game completion, goal changes, retries, and two-connection concurrency before any production rollout.

## Baseline test contract

`backend/tests/phase4b-v5cb-progress-write-baseline-pglite.test.ts` intentionally documents the **unsafe current state** on an in-memory PGlite database. Expected current result: **9 pass, 0 fail**. These tests are a characterization baseline, *not* approval of the exposed privileges. They must be rewritten to expect DENIAL once the coordinated hardening migration exists. Existing PGlite suites verify unrelated ACLs, but do not justify applying a cutover early.

This phase changes no existing code, schema or production behavior. It adds only evidence and a dependency map for the next feature-gated writer migration.
