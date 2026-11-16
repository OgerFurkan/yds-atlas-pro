# ADR 0002 — Scaffolding sentence difficulty and contextual word inspection

- **Status:** Proposed; pending Product Owner review, implementation and YDS golden-set evaluation
- **Date:** 2026-11-16
- **Scope:** Learning Game, shared English sentence rendering, Word Library

## Problem and evidence

At pinned staging commit `7e6ef874...`, `makeQuestion()` picks both group `context` and `final-context` from the same `usableExamples` array; example readiness only requires five target-containing sentences. It does not encode exercise difficulty. The current `QuizPanel` renders its sentence as plain text. `WordExample` highlights the focus word but offers no per-token dictionary actions. Customers reported that group-context sentences are too difficult and asked to tap English words for Turkish meaning, pronunciation and a reviewed add-to-library action.

## Decision

1. **Separate teaching from assessment.** Group-card and group-context stages use short, simple, natural examples; final-context uses more academic, YDS-style examples that still test the intended sense. Learning stage help does not count as independent exam evidence. Final-stage hints are disabled until answer submission. Keep 5/5/5/5/20 group and daily-plan semantics.
2. **Add explicit, optional sentence metadata** in a subsequent additive schema change: `purpose: practice | exam`, checked source, target sense/POS, language level and editorial-review status. The old five examples remain readable; they never silently become 'verified YDS' because a heuristic guessed a difficulty.
3. **Select deterministically by stage** from an eligible tagged pool. No arbitrary reshuffling of persisted questions on refresh; fail closed or mark legacy/no-level data as uncalibrated. Provide a compatibility policy for existing words/session snapshots before migration.
4. **Use a reusable EnglishTextWithInspector interface** where source text is trusted content but looked-up definitions may be uncertain. Tokenization preserves punctuation and supports case/inflection; multiword expressions and homographs require sense-aware review. Only attached user-library or curated references can show verified meaning; AI/dictionary suggestions are labeled and must be reviewed before saving.
5. **Use an accessible popover/non-modal dialog**, not a tooltip with buttons: keyboard and touch activatable; focus handling, Escape, screen readers. Reuse existing pronunciation hook (UK/US) and Word Library `WordFormDialog` save path; no duplicate entries or auto-marked readiness.
6. **Do not leak answers during tests.** In final context, disable word-inspector on the sentence and answer choices before answer. After submission, allow inspection with an explicit 'study aid used' event if needed by scoring analytics; never fabricate measured mastery.

## Delivery plan (separate PRs)

- A: schema + editorial/generator difficulty contract and phase-aware selector + engine tests with fixed seeds and old-session backwards-compatibility.
- B: WordInspector model/API + accessible component + tokenization tests + no-secret/timeout/source attribution.
- C: integrate into game, word examples, passages, AI English output where suitable; guest/account add flows and duplicate handling.
- D: YDS specialist golden-set, contrast/keyboard/mobile/E2E, two-account staging acceptance and rollbacks.

## Explicit non-goals

- No wholesale re-generation of user examples; no production migration in this ADR.
- Do not use YDS/ÖSYM copyrighted question sentences verbatim without authorization.
- No new LLM call per tap without explicit rate limits and caching.

## Current status

Architecture decision only; product feature **NOT IMPLEMENTED**, no stage-specific content yet and no global word-inspector yet.
