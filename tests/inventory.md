# Test inventory

The table records the move to the repository root and the main behavior reviewed in each file. The speech helper has no independently discoverable cases.

| Previous path                                               | Current path                                                                                                                                  | Behavior or role                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `backend/tests/auth.test.ts`                                | `tests/backend/auth/supabase-auth-boundary.test.ts`                                                                                           | Verified identity and fail-closed account writes                                 |
| `backend/tests/database.test.ts`                            | `tests/backend/database/postgres-ownership-and-atomicity.test.ts`                                                                             | Real SQL grants, RLS, atomic import and scoring, revisions and quota             |
| `backend/tests/feedback-inspector-migration.node.test.mjs`  | `tests/backend/database/feedback-lexicon-schema.node.test.mjs`                                                                                | Static Lexicon SQL grant and RLS contract                                        |
| `backend/tests/learning-api.test.ts`                        | `tests/backend/learning/learning-session-http.test.ts`                                                                                        | HTTP revision conflict and scoring from recorded assessment                      |
| `backend/tests/http-ai.test.ts`                             | `tests/backend/api/http-ai.test.ts`, `tests/backend/ai/gemini-provider-contract.test.ts`, `tests/backend/learning/assessment-scoring.test.ts` | Separate HTTP auth and quota, upstream response contracts and assessment scoring |
| `backend/tests/gemini-word-list-p0-hotfix.test.ts`          | `tests/backend/ai/gemini-word-list-recovery.test.ts`                                                                                          | Partial provider recovery and archival evidence                                  |
| `backend/tests/gemini-p0-live-502.test.ts`                  | `tests/backend/ai/gemini-word-list-schema-fallback.test.ts`                                                                                   | Mock MIME fallback after schema rejection                                        |
| `backend/tests/gemini-json-schema-cooldown.test.ts`         | `tests/backend/ai/gemini-json-schema-cooldown.test.ts`                                                                                        | Cooldown behavior                                                                |
| `backend/tests/gemini-model-fallback.test.ts`               | `tests/backend/ai/gemini-model-fallback.test.ts`                                                                                              | Bounded model changes                                                            |
| `backend/tests/gemini-resilience.test.ts`                   | `tests/backend/ai/gemini-resilience.test.ts`                                                                                                  | Retries, rotation and quotas                                                     |
| `backend/tests/gemini-validation-diagnostics.test.ts`       | `tests/backend/ai/gemini-validation-diagnostics.test.ts`                                                                                      | Validation diagnostics                                                           |
| `backend/tests/turkish-wiktionary-fallback.test.ts`         | `tests/backend/lexicon/turkish-wiktionary-fallback.test.ts`                                                                                   | Licensed provider fallback                                                       |
| `backend/tests/legacy-gloss-extraction.test.ts`             | `tests/backend/lexicon/legacy-gloss-extraction.test.ts`                                                                                       | Legacy gloss extraction                                                          |
| `backend/tests/persistent-tooltip-queue.node.test.mjs`      | `tests/backend/lexicon/persistent-tooltip-queue.node.test.mjs`                                                                                | Durable queue claims, retries and SQL constraints                                |
| `backend/tests/sentence-tooltip-contract.node.test.mjs`     | `tests/backend/lexicon/sentence-tooltip-contract.node.test.mjs`                                                                               | Tooltip provenance, publication and generation                                   |
| `backend/tests/game-safe-dictionary.node.test.mjs`          | `tests/backend/lexicon/game-safe-dictionary.node.test.mjs`                                                                                    | Assessment-safe dictionary behavior                                              |
| `backend/tests/feedback-two-features-api.node.test.mjs`     | `tests/backend/lexicon/feedback-lexicon-http.node.test.mjs`                                                                                   | Lexicon route dispatch and feature gates                                         |
| `backend/tests/feedback-inspector-service.node.test.mjs`    | `tests/backend/lexicon/feedback-inspector-service.node.test.mjs`                                                                              | Inspector access and draft service                                               |
| `backend/tests/feedback-inspector-validation.node.test.mjs` | `tests/backend/lexicon/feedback-inspector-validation.node.test.mjs`                                                                           | Inspector input validation                                                       |
| `frontend/tests/unit/account-isolation.test.ts`             | `tests/frontend/unit/account-isolation.test.ts`                                                                                               | Owner cache isolation and revision ordering                                      |
| `frontend/tests/unit/ai-chat-retry.test.ts`                 | `tests/frontend/unit/ai-chat-retry.test.ts`                                                                                                   | Retry uses the last failed question                                              |
| `frontend/tests/unit/ai-issues.test.ts`                     | `tests/frontend/unit/ai-issues.test.ts`                                                                                                       | Issue notification and clearing                                                  |
| `frontend/tests/unit/ai-retry.test.ts`                      | `tests/frontend/unit/ai-retry.test.ts`                                                                                                        | Bounded retries and cancellation                                                 |
| `frontend/tests/unit/atlas-tiered-examples.test.ts`         | `tests/frontend/unit/atlas-tiered-examples.test.ts`                                                                                           | Example tiers and translation focus                                              |
| `frontend/tests/unit/chat-history.test.ts`                  | `tests/frontend/unit/chat-history.test.ts`                                                                                                    | Conversation deletion                                                            |
| `frontend/tests/unit/chat-markdown.test.ts`                 | `tests/frontend/unit/chat-markdown.test.ts`                                                                                                   | Chat rendering keeps input as text                                               |
| `frontend/tests/unit/daily-groups.test.ts`                  | `tests/frontend/unit/daily-groups.test.ts`                                                                                                    | Daily capacity and score thresholds                                              |
| `frontend/tests/unit/daily-word-groups-repository.test.ts`  | `tests/frontend/unit/daily-word-groups-repository.test.ts`                                                                                    | Assignment, movement, cleanup and exclusions                                     |
| `frontend/tests/unit/day-review.test.ts`                    | `tests/frontend/unit/day-review.test.ts`                                                                                                      | Review eligibility and read-only progress                                        |
| `frontend/tests/unit/game-engine.test.ts`                   | `tests/frontend/unit/game-engine.test.ts`                                                                                                     | Game transitions, retries and scoring                                            |
| `frontend/tests/unit/game-setup.test.ts`                    | `tests/frontend/unit/game-setup.test.ts`                                                                                                      | Setup and source selection                                                       |
| `frontend/tests/unit/i18n-resources.test.ts`                | `tests/frontend/unit/i18n-resources.test.ts`                                                                                                  | Turkish and English resources                                                    |
| `frontend/tests/unit/legacy-curated-examples.test.ts`       | `tests/frontend/unit/legacy-curated-examples.test.ts`                                                                                         | Curated fallback examples                                                        |
| `frontend/tests/unit/manual-word-import.test.ts`            | `tests/frontend/unit/manual-word-import.test.ts`                                                                                              | Bulk import parsing and filtering                                                |
| `frontend/tests/unit/matching-assessment.test.ts`           | `tests/frontend/unit/matching-assessment.test.ts`                                                                                             | Matching and versioned assessment                                                |
| `frontend/tests/unit/merge-legacy-tiered-examples.test.ts`  | `tests/frontend/unit/merge-legacy-tiered-examples.test.ts`                                                                                    | Legacy example preservation                                                      |
| `frontend/tests/unit/persistence.test.ts`                   | `tests/frontend/unit/persistence.test.ts`                                                                                                     | Atomic offline import, snapshots and retries                                     |
| `frontend/tests/unit/prepare-word-inputs-recovery.test.ts`  | `tests/frontend/unit/prepare-word-inputs-recovery.test.ts`                                                                                    | Batch fallback and partial recovery                                              |
| `frontend/tests/unit/public-env.test.ts`                    | `tests/frontend/unit/public-env.test.ts`                                                                                                      | Rejects elevated frontend keys                                                   |
| `frontend/tests/unit/streak.test.ts`                        | `tests/frontend/unit/streak.test.ts`                                                                                                          | Istanbul date and streak behavior                                                |
| `frontend/tests/unit/word-form-mappers-metadata.test.ts`    | `tests/frontend/unit/word-form-mappers-metadata.test.ts`                                                                                      | Word metadata preservation                                                       |
| `frontend/tests/unit/word-library-view.test.ts`             | `tests/frontend/unit/word-library-view.test.ts`                                                                                               | Search, filtering and display                                                    |
| `frontend/tests/unit/word-normalization.test.ts`            | `tests/frontend/unit/word-normalization.test.ts`                                                                                              | Word normalization and score bands                                               |
| `frontend/tests/atlas-tiered-examples.node.test.mjs`        | `tests/frontend/node/atlas-tiered-examples.node.test.mjs`                                                                                     | Native Node VM tier rejection                                                    |
| `frontend/tests/feedback-auth-storage.node.test.mjs`        | `tests/frontend/node/auth-storage.node.test.mjs`                                                                                              | Native Node VM browser storage and remember-me behavior                          |
| `frontend/tests/e2e/auth-page.spec.ts`                      | `tests/frontend/e2e/auth-page.spec.ts`                                                                                                        | Guest sign-in and sign-up UI                                                     |
| `frontend/tests/e2e/daily-i18n-card.spec.ts`                | `tests/frontend/e2e/daily-i18n-card.spec.ts`                                                                                                  | Localized plan and flashcard UI                                                  |
| `frontend/tests/e2e/daily-plan.spec.ts`                     | `tests/frontend/e2e/daily-plan.spec.ts`                                                                                                       | Assignments, movement and study start                                            |
| `frontend/tests/e2e/day-review.spec.ts`                     | `tests/frontend/e2e/day-review.spec.ts`                                                                                                       | Read-only review and session resume                                              |
| `frontend/tests/e2e/learning-flow.spec.ts`                  | `tests/frontend/e2e/learning-flow.spec.ts`                                                                                                    | Import, saved game, results and tutorials                                        |
| `frontend/tests/e2e/overflow-diagnostic.spec.ts`            | `tests/frontend/e2e/overflow-diagnostic.spec.ts`                                                                                              | Daily-plan overflow across viewports                                             |
| `frontend/tests/e2e/ui-regressions.spec.ts`                 | `tests/frontend/e2e/ui-regressions.spec.ts`                                                                                                   | Responsive UI, speech and chat                                                   |
| `frontend/tests/cloud/account-flow.spec.ts`                 | `tests/frontend/contracts/account-flow.spec.ts`                                                                                               | Mock authenticated persistence, account change and scores                        |
| `frontend/tests/cloud/feedback-inspector.spec.ts`           | `tests/frontend/contracts/feedback-inspector.spec.ts`                                                                                         | Mock Inspector and dictionary UI                                                 |
| `frontend/tests/dev/cold-start.spec.ts`                     | `tests/frontend/dev/cold-start.spec.ts`                                                                                                       | Cold Vite spelling flow                                                          |
| `frontend/tests/helpers/speech-mock.ts`                     | `tests/frontend/helpers/speech-mock.ts`                                                                                                       | Shared deterministic speech helper for browser specs                             |

The three storage test files now share a fixture that restores the original
property after each test. The split HTTP suite shares its synthetic word.
Both changes preserve the original assertions. Native Node frontend tests
remain separate because they exercise browser storage and tier validation in
a Node VM. No file was dropped as redundant. Several backend source-shape
checks remain for historical invariants and have narrower guarantees than a
live HTTP or database test.

## New regression suites

| Path                                               | Runner and coverage                                          |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `backend/database/isolated-score-security.test.ts` | Opt-in isolated LOCAL PostgreSQL, Auth and PostgREST         |
| `backend/api/word-edit-http.test.ts`               | Bun word PATCH/PUT revision and protected fields             |
| `frontend/e2e/word-edit-concurrency.spec.ts`       | Chromium two-tab draft, score and note protection            |
| `frontend/contracts/day-study.spec.ts`             | Mock health, preparation, cancellation and partial readiness |
| `frontend/dev/local-fixture-library.spec.ts`       | Synthetic local library and score-free review                |
| `frontend/demo/day-study.spec.ts`                  | Interactive synthetic demo                                   |

## Historical Bun LCOV snapshot

The local Bun run listed 80 of 196 production script files. The 116 paths below had no LCOV entry. Some are exercised by Playwright or the legacy VM harnesses. Type-only modules can also appear here. Appearance in LCOV means the runner loaded a file, and coverage percentages count only instrumented code.

To regenerate LCOV on Windows, run the following from the repository root.

```powershell
bun run test:coverage --coverage-reporter=lcov --coverage-dir (Join-Path ([System.IO.Path]::GetTempPath()) 'yds-atlas-coverage')
```

<details><summary>backend (1)</summary>

- `backend/src/index.ts`

</details>

<details><summary>frontend (114)</summary>

- `frontend/src/app/App.tsx`
- `frontend/src/app/components/app-footer.tsx`
- `frontend/src/app/components/app-header.tsx`
- `frontend/src/app/components/atlas-toast-controls.tsx`
- `frontend/src/app/components/learning-menu.tsx`
- `frontend/src/app/config/learning-activities.ts`
- `frontend/src/app/hooks/use-hash-screen.ts`
- `frontend/src/app/hooks/use-notify.ts`
- `frontend/src/features/account/api/account-api.ts`
- `frontend/src/features/account/components/account-workspace.tsx`
- `frontend/src/features/account/hooks/use-account-data.ts`
- `frontend/src/features/account/model/account-cache.ts`
- `frontend/src/features/ai-chat/api/ai-chat-api.ts`
- `frontend/src/features/ai-chat/components/ai-chat-widget.tsx`
- `frontend/src/features/ai-chat/components/chat-message-markdown.tsx`
- `frontend/src/features/auth/components/account-dialog.tsx`
- `frontend/src/features/auth/components/auth-form.tsx`
- `frontend/src/features/auth/components/login-page.tsx`
- `frontend/src/features/auth/hooks/use-auth-form.ts`
- `frontend/src/features/auth/hooks/use-auth.ts`
- `frontend/src/features/auth/model/auth-schema.ts`
- `frontend/src/features/dashboard/components/atlas-companion.tsx`
- `frontend/src/features/dashboard/components/daily-goal-hero.tsx`
- `frontend/src/features/dashboard/components/dashboard-page.tsx`
- `frontend/src/features/dashboard/components/recent-word.tsx`
- `frontend/src/features/dashboard/components/streak-card.tsx`
- `frontend/src/features/learning-game/components/answer-feedback.tsx`
- `frontend/src/features/learning-game/components/fitted-word.tsx`
- `frontend/src/features/learning-game/components/flashcard-faces.tsx`
- `frontend/src/features/learning-game/components/flashcard-panel.tsx`
- `frontend/src/features/learning-game/components/game-play.tsx`
- `frontend/src/features/learning-game/components/game-progress.tsx`
- `frontend/src/features/learning-game/components/game-results.tsx`
- `frontend/src/features/learning-game/components/game-setup.tsx`
- `frontend/src/features/learning-game/components/learning-game-page.tsx`
- `frontend/src/features/learning-game/components/matching-panel.tsx`
- `frontend/src/features/learning-game/components/quiz-panel.tsx`
- `frontend/src/features/learning-game/components/setup-intro.tsx`
- `frontend/src/features/learning-game/components/setup-source-picker.tsx`
- `frontend/src/features/learning-game/components/setup-summary.tsx`
- `frontend/src/features/learning-game/components/setup-task-settings.tsx`
- `frontend/src/features/learning-game/hooks/use-card-flip.ts`
- `frontend/src/features/learning-game/hooks/use-setup-guide.ts`
- `frontend/src/features/learning-game/model/game-progress.ts`
- `frontend/src/features/learning-game/model/play-guide.ts`
- `frontend/src/features/learning-game/model/setup-guide.ts`
- `frontend/src/features/learning-game/model/tutorial-steps.ts`
- `frontend/src/features/word-inspector/api/sentence-draft-schema.ts`
- `frontend/src/features/word-inspector/api/word-inspector-api.ts`
- `frontend/src/features/word-inspector/components/tiered-sentence-preview.tsx`
- `frontend/src/features/word-inspector/components/word-inspector-page.tsx`
- `frontend/src/features/word-inspector/model/word-inspector-model.ts`
- `frontend/src/features/word-library/api/spellcheck.ts`
- `frontend/src/features/word-library/api/word-api.ts`
- `frontend/src/features/word-library/api/word-repository.ts`
- `frontend/src/features/word-library/components/ai-fill-progress.tsx`
- `frontend/src/features/word-library/components/ai-word-assist.tsx`
- `frontend/src/features/word-library/components/bulk-word-dialog.tsx`
- `frontend/src/features/word-library/components/daily-group-card.tsx`
- `frontend/src/features/word-library/components/daily-plan-view.tsx`
- `frontend/src/features/word-library/components/day-review-panel.tsx`
- `frontend/src/features/word-library/components/legacy-tier-upgrade.tsx`
- `frontend/src/features/word-library/components/library-filter-tabs.tsx`
- `frontend/src/features/word-library/components/library-selection-bar.tsx`
- `frontend/src/features/word-library/components/library-status.tsx`
- `frontend/src/features/word-library/components/library-summary.tsx`
- `frontend/src/features/word-library/components/library-toolbar.tsx`
- `frontend/src/features/word-library/components/library-view-tabs.tsx`
- `frontend/src/features/word-library/components/pronunciation-buttons.tsx`
- `frontend/src/features/word-library/components/sentence-word-tooltips.tsx`
- `frontend/src/features/word-library/components/tooltip-backfill.tsx`
- `frontend/src/features/word-library/components/word-details.tsx`
- `frontend/src/features/word-library/components/word-example.tsx`
- `frontend/src/features/word-library/components/word-form-dialog.tsx`
- `frontend/src/features/word-library/components/word-form-fields.tsx`
- `frontend/src/features/word-library/components/word-import-review.tsx`
- `frontend/src/features/word-library/components/word-library-page.tsx`
- `frontend/src/features/word-library/components/word-list.tsx`
- `frontend/src/features/word-library/components/word-status.tsx`
- `frontend/src/features/word-library/hooks/use-daily-plan.ts`
- `frontend/src/features/word-library/hooks/use-word-library-view.ts`
- `frontend/src/features/word-library/hooks/use-word-library.ts`
- `frontend/src/features/word-library/hooks/use-word-selection.ts`
- `frontend/src/features/word-library/hooks/use-word-spellcheck.ts`
- `frontend/src/features/word-library/model/sentence-tooltip.ts`
- `frontend/src/features/word-library/model/spellcheck.types.ts`
- `frontend/src/features/word-library/workers/spellcheck.worker.ts`
- `frontend/src/main.tsx`
- `frontend/src/shared/api/ai-health.ts`
- `frontend/src/shared/brand/atlas-logo.tsx`
- `frontend/src/shared/hooks/app-preferences-context.ts`
- `frontend/src/shared/hooks/app-preferences-provider.tsx`
- `frontend/src/shared/hooks/use-app-preferences.tsx`
- `frontend/src/shared/hooks/use-prefers-reduced-motion.ts`
- `frontend/src/shared/hooks/use-pronunciation.ts`
- `frontend/src/shared/i18n/i18n.ts`
- `frontend/src/shared/lib/notify.ts`
- `frontend/src/shared/lib/utils.ts`
- `frontend/src/shared/ui/alert.tsx`
- `frontend/src/shared/ui/badge.tsx`
- `frontend/src/shared/ui/button.tsx`
- `frontend/src/shared/ui/card.tsx`
- `frontend/src/shared/ui/checkbox.tsx`
- `frontend/src/shared/ui/dialog.tsx`
- `frontend/src/shared/ui/dropdown-menu.tsx`
- `frontend/src/shared/ui/gemini-status-card.tsx`
- `frontend/src/shared/ui/guided-tour.tsx`
- `frontend/src/shared/ui/input.tsx`
- `frontend/src/shared/ui/preferences-dialog.tsx`
- `frontend/src/shared/ui/progress.tsx`
- `frontend/src/shared/ui/select.tsx`
- `frontend/src/shared/ui/separator.tsx`
- `frontend/src/shared/ui/tabs.tsx`
- `frontend/src/shared/ui/textarea.tsx`

</details>

<details><summary>packages (1)</summary>

- `packages/shared/src/types/daily-word-group.ts`

</details>
