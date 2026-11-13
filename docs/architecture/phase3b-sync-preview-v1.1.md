# Phase 3B — Sync Preview v1.1

**Base:** Phase 3B preflight commit `dbbf3f7400b41d7b7fdd29b07293514f1410721b` (PR #5; stacked on Phase 3A, PR #3).

## Change

- Add a compact Cloud Plan Comparison entry on the existing Daily Plan screen.
- Show a bilingual, accessible dialog: local and cloud word counts, cloud revision, changes to placements, exclusions, daily target and per-day order, plus blocking errors.
- Manual **Compare plans** triggers the already-existing `previewDailyPlanSync` GET-only helper. Merely opening the dialog does not issue requests.
- Guest sessions may inspect the read-only explanation but cannot start a cloud request.
- When a difference requires a choice, provide three **ephemeral UI-only** options: decide later, prefer local, prefer cloud. Nothing is persisted and no plan is changed.
- In-flight responses are ignored after close/unmount; no background polling.
- Add a guest E2E test verifying dialog access and no cloud request.

## Invariants

- **No GET on page load, no PUT, no SQL, no migration, no background sync, no automatic reconciliation, no destructive action.**
- The cloud API is available only when the signed-in account ID is explicitly passed from App to WordLibraryPage to DailyPlanView. The existing API still binds requests to the authenticated user.
- Existing scoped browser storage is read only after an explicit click; preflight remains fail-closed for invalid local records.
- The `5 → 5 → 5 → 5 → all 20` learning flow and PRs #2/#3/#4 are unaffected.
- Dark mode follows app semantic `bg-card`, `bg-muted`, `text-foreground` tokens; warning and failure panels use deliberate high contrast.
- This does not mean the cloud table/API has been provisioned. Until the **staging** migration is complete, an authenticated GET may show a safe API error.

## Rollout

1. Run the installer in dry-run mode; confirm expected branch `feature/atlas-phase3b-sync-20261113` and exact HEAD `dbbf3f7`.
2. Apply only if checks pass. Test `bun run test:unit`, `bun run test:api`, `bun run build`, `bun run lint`, `bun run test:e2e`.
3. Commit these changes on Phase 3B and push to update existing PR #5; **do not merge**.
4. Prepare a staging-only, reviewed migration and RLS test plan; never run the Phase 3A draft SQL on production directly.
