# Phase 3B v1.2 — Authenticated read-only sync preview contract tests

**Base:** `feature/atlas-phase3b-sync-20261113` @ `7a7f0975e7477ff22ca85deccfb7862836e75e7a`.

## Scope

This increment adds three **authenticated browser contract tests** to the existing
`frontend/tests/cloud/account-flow.spec.ts` suite (desktop and mobile). The suite
uses its established **mock Supabase Auth and API routes**. These tests do not
access a real Supabase project or an actual user account.

1. Explicit user click issues **one authenticated GET**; merely opening the
   dialog causes no API request. A conflict in day placement and target size is
   shown; the tentative choice does not modify account-scoped localStorage.
   Closing and reopening clears the comparison and the tentative choice.
2. HTTP 409 conflict appears as an actionable error; retry only makes GET calls.
3. A cloud snapshot referencing a word not in the authenticated user's library
   blocks the preflight and offers **no resolution-choice radios**.

All tests assert the scoped daily-plan storage contents are unchanged by the
preview. Application code, backend endpoints, SQL and migrations are **untouched**.

## Run (from repository root)

```
bun run test:cloud
bun run test:unit
bun run test:api
bun run build
bun run lint
bun run test:e2e
```

Expected additional tests: 3 tests x 2 Playwright projects = **6 cloud browser
cases**. The tests may require Playwright browser installation; do not point
cloud configuration at a production Supabase instance.

## Caveats

- This validates authenticated browser wiring against *mocked* endpoints, not
  real deployment connectivity, RLS policies, schema migration, server JWT
  enforcement or 409 behavior under actual database concurrency.
- Existing `useDailyPlan` may initialize local assignments when the plan screen
  mounts; the tests capture their baseline after mounting and verify that the
  **preview itself** does not mutate them.
- Before any real synchronization: staging backup, reviewed migration, RLS
  tests, two-account isolation, revision conflict tests, rollback plan and
  explicit disabled-by-default rollout flag remain mandatory.
