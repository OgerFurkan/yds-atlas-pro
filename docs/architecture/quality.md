# Quality and validation

## Local checks and PR gates

Run these commands from the repository root.

```powershell
bun run lint
bun run check
bun run build:test
bun run test
bun run test:node
node scripts/quality/repository-audit.mjs
bun run test:e2e
bun run test:cloud
```

The GitHub Actions `test` job runs for PRs targeting `main` or `atlas-staging` and
for pushes to `main`. A newer run can cancel an older run for the same PR. Each
`main` push has its own run group. The PR job uses Bun 1.3.5 and Node 24.
It checks lint and Biome across the repository, builds the isolated browser
artifact, runs Bun and Node tests and the repository audit, then runs both
local Chromium suites. The checkout includes the immutable Git history
required by the archived Gemini regressions.

The Bun tests cover pure models, the Bun API with synthetic responses, and
SQL/RLS with the checked-in SQL loaded into an in-memory PGlite database.
Playwright E2E exercises the local build (guest flows). Cloud-contract
Playwright uses a local app and intercepted Auth and account API responses
(sign-in, persistence, account switching and score synchronization).
Both suites run on desktop and mobile Chromium.
See the [central test tree](../../tests/README.md) for native Node and cold
development server checks.

## Optional coverage and security checks

Run `bun run test:coverage` to get Bun's function and line coverage in the
terminal. It measures source files loaded by the unit/API test selection.
SQL policies, code never loaded by these tests, and browser flows are outside
this percentage. Compare like-for-like runs on the same Bun version before
setting a threshold. Coverage is an opt-in local check.

The repository audit reports large source files, shared-to-feature imports,
and tracked backup artifacts and sensitive filenames. The frontend build also
rejects elevated keys configured as public variables. Neither check scans the
entire Git history for secrets.

For a separately authorized advisory check, `bun audit` reads the lockfile
and queries a package advisory endpoint. Review the results after dependency
changes. For broader secret coverage, a separately installed Gitleaks can scan
the repository or its history locally. Run it with redaction before enabling
any recurring check. Both checks are optional and add no PR jobs.

## Acceptance on fixed staging

Run this checklist only under a separate staging authorization. Use the
approved, fixed staging URL for the frontend and its intended staging API and
database. Record the release ID and timestamp and prepare two disposable
accounts, A and B, in separate browser profiles. Use unique synthetic words
and manually supplied examples to avoid provider calls.

1. Open the app as a guest. Confirm only guest data is visible. Sign in as A,
   verify the active account, and confirm authenticated writes work. Sign out
   and confirm the guest library returns.
2. As A, add a word to the library, keep its meaning and examples, and start a
   playable group from the daily plan. Supply five translated examples for
   each fixture word. Reload mid-session. Sign out and back in, then check
   the word and resumable session. If testing in two A tabs, save from the
   first tab and confirm the stale tab cannot overwrite it.
3. Sign in as B. Verify A's words and unfinished session are absent in the UI
   and in the normal account read responses under B's session. Save B's own
   word and sign back in as A in that profile. Verify B's word is absent and
   A's words and session are intact.
4. As A, finish the assessment with no matching errors and both correct answers
   marked “Hatırladım” for a fixture word. Confirm its score is 88 and daily
   progress counts it once. Reload and confirm the score and count persist.
   Start a score-free review and confirm neither value changes.
5. Return to B. Verify A's learning history and daily progress are absent
   under B's session and B's own word is still present. For the RLS check,
   confirm the exposed account lists are also owner-scoped when read with
   each user's authenticated staging client.
6. Record pass or fail for each check and capture only redacted evidence.
   Hold promotion on any account isolation, persistence or scoring failure.
   Keep the staging result separate from local mock and PGlite results.

## Rollback on fixed staging

Before acceptance, record the last known-good frontend and API release IDs,
confirm that the pair is compatible with the existing staging schema, and
identify the authorized release operator. On an acceptance failure, stop
promotion and preserve redacted evidence. Ask the operator to restore the
compatible release pair in staging and rerun the acceptance checklist,
starting with sign-in and account isolation. If the previous pair is
incompatible with the current schema, pause for a separate recovery decision
with the data owner. Preserve the staging data and schema throughout this
application rollback.

## Gemini capacity

Gemini quotas are applied per Google Cloud project, not per API key. New keys
in the same project do not raise project limits. Keep all keys in backend-only
secrets and observe per-project RPM, TPM and daily quotas before increasing traffic.

## Score integrity

Bun replays the user's selections against the verified session and PostgreSQL
writes the score and progress in one transaction. A stale revision cannot
overwrite a completed result. Older v2/v3 account sessions count as practice.
The embedded SQL tests assert the current role and RPC allowlist. The separate
isolated Supabase test validates two accounts, the writer role and concurrent
completion against real LOCAL PostgreSQL, Auth and PostgREST.
