# Phase 4B v5C-E: separate manual group from game score (additive candidate)

## Observed data model

* `words.score` currently drives **both** manual library group choices and game score.
* `apply_word_scores`, `saveWord`, and `import_words` allow authenticated writes to `words.score`. A game is not required.
* All previously stored `score` values may mix manually selected labels and game outcomes. Their provenance cannot be reconstructed from the numerical value alone.
* `wordEntrySchema` and current dashboard/daily plan logic derive displayed groups from score thresholds (0–39 hard; 40–79 review; 80–100 learned).

## This candidate (no cutover yet)

1. Adds an **optional** `manual_group` column and owner-scoped, `SECURITY INVOKER` bulk RPC in REVIEW-ONLY SQL.
2. Adds `PUT /api/words/groups` with body `[{"id":"uuid","group":"hard|review|learned"}]`. Strict inputs, deduplication, full row-count validation. This endpoint is **not called by the existing UI yet**; do not enable it on a remote DB before the additive SQL is installed and verified.
3. Word API maps `manual_group` from the database column only, never from user-editable `content`. Missing/null manual group falls back to legacy score thresholds.
4. Updates group-display calculations and game readiness to prefer explicit manual group when present, without changing old records.
5. Preserves existing game result scoring and legacy RPCs; leaves score writes in place until a later coordinated cutover.

## Next cutover (NOT done here)

* Locate every frontend caller of `repository.applyScores`, word edit and import. Do not silently redirect game-completion score writes to manual labels.
* Wire manual drag/drop and group actions to `/api/words/groups`, leaving game completion on the transactional v3 RPC only.
* Ensure ordinary word editing and importing omit `score` on database writes; update the `import_words` path to insert score DEFAULT 0. Restrict the `authenticated` role's table-level INSERT/UPDATE privileges with a tested per-column grant matrix (RLS alone does not protect score). Revoke direct `apply_word_scores` EXECUTE.
* Ensure backend v3/v5/v6 writers, SQL and existing legacy cutovers are deployed in tested order **before** privilege removal; flags remain OFF in this candidate.
* Validate existing legacy scores as **unknown provenance**; do not label old scores as verified outcomes without trusted completion ledger evidence.
* Complete real Postgres16 multi-owner tests, E2E of drag/drop + add/import + game and staged rollout before any production change.

No staging/prod SQL, feature flag, deploy or push is performed by this candidate.
