# Phase 4B v5C-D — Real PostgreSQL 16 cutover acceptance (LOCAL ONLY)

This is a **disposable Docker test**, not a schema migration, staging rollout, or approval to enable flags. No remote database is accessed; all SQL is loaded into a fresh `postgres:16-alpine` container with no mounted volumes and a loopback-only ephemeral port. The runner deletes the container when the test ends.

## Preconditions

- Clean `feature/atlas-smart-daily-plan-20261114` branch at `f339d2f77d3b4c4017072a2cc3d75073d56e5c4f`.
- Bun and Docker Desktop running, local `postgres:16-alpine` image present.
- Newly added three files from this candidate package, and no other worktree changes.

Run `& .\scripts\quality\phase4b-v5cd-run-local.ps1` from the repository. Do **not** run the `REVIEW-ONLY.sql` files in staging or production.

## What this acceptance covers

1. Original migration history loads into genuine PostgreSQL 16.
2. Review-only **additive** v3 completion, v5 session save and v6 goal writer, then **breaking** ledger cutover SQL load into disposable DB.
3. Real `has_function_privilege` and `has_table_privilege` post-cutover ACLs deny legacy authenticated write bypasses.
4. Authenticated SQL attempts to forge ledger/daily completions/milestones and call private goal writer are rejected.
5. Service_role v5 creation + CAS conflict, v3 completed result and idempotent replay maintain one ledger, SRS and daily completion.
6. Ten real v3 completed sessions cross goal=10 once; other account remains unaffected; RLS still isolates reads.
7. **Known gap preserved**: a user can still edit `public.words.score` manually; this field must not be treated as an attested game score until manual grouping and learning outcomes are separately modeled.

## Limitations and rollout gates

- The authenticated user still controls the snapshot sent to the Bun backend; database score verification against a stored snapshot is not independent proof that a user really answered questions. Do not call this anti-cheat complete.
- `public.words.score`, `import_words`, `apply_word_scores` remain user-editable by design in this phase. Preserve manual library status changes until the group/score split lands.
- `public.profiles.daily_goal` retains owner-scoped direct update permissions; it is not an authoritative audit history field.
- This test proves DB-level behavior in a disposable fixture, not frontend live auth/realtime/network integration.
- **STAGING ONLY, separate approval required**: install additive v3/v5/v6 functions, verify service_role ACLs, backend service-secret configuration, deploy backend with new flags, test real authenticated API sessions, then coordinate breaking revocations only when old clients are retired.
- Production cutover only after staging acceptance, rollback plan and explicit user approval. No migration or flags in this package.
