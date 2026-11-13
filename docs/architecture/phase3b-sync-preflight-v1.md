# Phase 3B — Sync Preflight v1 (read-only foundation)

**Base:** Phase 3A commit `f5b67d8afa5b989e601e30c1725cda38a5bc9a4d`.

## What's in this increment

- `inspectDailyPlanSyncPreflight`: pure local/cloud comparison; placements, exclusion sets, group size, per-day word order, revision, stale/invalid IDs, invalid snapshot format.
- `readLocalDailyPlanForPreflight`: read-only access to the currently scoped browser storage keys; corrupt/unreadable data blocks the flow instead of becoming an empty plan.
- `previewDailyPlanSync`: explicit opt-in authenticated GET helper for a future preview screen. **Not mounted or invoked by the app.**
- Unit tests for the comparison and storage safety properties.

## What it intentionally does NOT do

- No `PUT`, no database migration, no SQL execution, no change to production or staging environments.
- No automatic cloud/local migration or overwrite, no background sync, no UI entry point, no merge decision persisted.
- No changes to the daily 5 + 5 + 5 + 5 + all-20 game flow.
- No use of `syncWords()` while reading: that method writes local state.
- No fallback from a corrupt local plan to an empty local plan.

## Limitations and next step

- A browser record with non-UUID/legacy word IDs is blocked for manual reconciliation; not silently discarded or coerced.
- A known-word list must be supplied by the authenticated library when comparing; do not use the public starter vocabulary as authoritative account ownership.
- The current storage scope must be set to the signed-in account before invoking `readLocalDailyPlanForPreflight`.
- Next PR increment: a localized, accessible **preview-only** UI showing differences, conflicts and explicit user choices without activating saving; then staging migration/RLS tests, then revision-based synchronization behind a disabled-by-default flag.

## Verification

On the isolated Phase 3B branch:

```
bun run test:unit
bun run test:api
bun run build
bun run lint
bun run test:e2e
```

Do not merge Phase 2, Phase 3A or the Word Readiness hotfix PR as an incidental consequence of this change.
