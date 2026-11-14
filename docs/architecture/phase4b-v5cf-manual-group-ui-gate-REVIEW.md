# Phase 4B v5C-F — manual group UI wiring (candidate only)

## What changed

* WordRepository now supports `setGroups`, with the signed-in implementation calling `PUT /api/words/groups` and guest implementation modifying `manualGroup` locally while preserving `score`.
* Library shows accessible group selects and drag-to-group targets; `WordStatus` labels reflect explicit manual classification. All score fields stay as measured/legacy numbers.
* Word edit in local repository preserves any existing manualGroup label.
* UI (guest and signed-in) is OFF by default, gated on `VITE_MANUAL_WORD_GROUPS_ENABLED=true`. Do **not** enable this variable in a remote deployment until v5C-E additive manual_group SQL is installed and verified in staging and the backend endpoint is deployed.
* When explicitly enabled, guest group choices persist locally; this does not grant new authority to signed-in clients.

## Important limitations

* This is **not** the score cutover. `words.score`, `apply_word_scores`, `saveWord` and `import_words` still admit arbitrary authenticated values; old score provenance cannot be trusted.
* The signed-in UI MUST NOT be enabled in production before additive SQL migration. Guest manual classification persists only in guest storage.
* Do not deploy review-only SQL automatically; do not enable any of the session/review/goal flags without full staging backend and database tests.
* Review the remaining completion fallback: signed-in sessions must not fall back to `/api/words/scores` after restricting scoring privileges.
* Future work: add PostgreSQL score-column privilege matrix and secure create/import, plus real end-to-end signed-in tests; consider a manual-label reset operation and multi-select group actions.
