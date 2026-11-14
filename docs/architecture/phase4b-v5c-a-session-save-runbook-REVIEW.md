# Phase 4B v5C-A — opt-in server-only session save integration (LOCAL CANDIDATE)

**Exact local baseline:** `e8b098ba88f8fb13351b3922f8d184100e189204` on `feature/atlas-smart-daily-plan-20261114`.

## What this does

- Adds `SESSION_SAVE_V5_ENABLED` (default **false**) to `readConfig`.
- When false, `PUT /api/learning/session` continues calling the existing JWT-scoped `save_learning_session` RPC.
- When true, after verified JWT authentication and shared-game schema validation, the backend alone calls `save_learning_session_v5(p_owner_id, p_id, p_snapshot, p_expected_revision)` using a separate service-only client without forwarded JWT.
- Reports revision conflicts as HTTP 409, missing server credentials as HTTP 503, and rejects malformed revision responses.
- Adds isolated mocked API boundary tests. No SQL, migration or permissions are applied.

## Test and rollout requirements

Local: `bun test backend/tests/session-save-writer-boundary.test.ts` then full `bun test backend/tests frontend/tests/unit`, `bun run build`, `bun run lint`, UI e2e as required. **Do not enable the flag from this patch alone.**

Before enabling in staging, the reviewed `phase4b-v5a-session-writer-REVIEW-ONLY.sql` must be installed safely on staging as part of an approved coordinated migration. Before revoking JWT direct session INSERT/UPDATE or the legacy save RPC, **both** completion paths must be migrated and old direct progress writes audited. The v3 completion writer and v4 cutover are still review candidates. Never apply the v5A cutover SQL independently.

The `service_role` credential must remain server-side. The external client never supplies `p_owner_id`. The RPC enforces ownership/CAS but cannot cryptographically prove quiz answers genuinely came from a human. v5C-B must audit direct word score writes and daily progress INSERT rights before any production claim.

Rollback while flag remains OFF is simply to remove the candidate code files. An actual deployed cutover needs a separately reviewed maintenance and rollback procedure.
