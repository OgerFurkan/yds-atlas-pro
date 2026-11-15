# Atlas Learning Engine v2 — evidence-first product and safety contract

## Scientific basis (design constraints, not marketing guarantees)

1. **Retrieval practice and distributed practice** generally outperform passive rereading for longer-term retention. Dunlosky et al. (2013) https://pubmed.ncbi.nlm.nih.gov/26173288/; Carpenter, Pan & Butler (2022) https://www.nature.com/articles/s44159-022-00089-1
2. **Second-language vocabulary** benefits from spacing and feedback; test-and-feedback in a web vocabulary application improved retention under particular conditions. https://pubmed.ncbi.nlm.nih.gov/34867656/; L2 spacing meta-analysis https://onlinelibrary.wiley.com/doi/full/10.1111/lang.12479
3. **Varying contextual sentences** while retrieving meanings can improve outcomes compared with repeated identical examples (not every task should be randomized blindly). https://pmc.ncbi.nlm.nih.gov/articles/PMC11536137/
4. A 2026 meta-analysis cautions that effectiveness is sensitive to the retrieval task, feedback and knowledge type. https://link.springer.com/article/10.1007/s10648-026-10225-5
5. FSRS models difficulty/stability/retrievability but requires correct review event semantics and calibration. **Atlas v2 does not claim to implement FSRS or estimate a calibrated 90% retention probability.** https://open-spaced-repetition.github.io/ and https://docs.ankiweb.net/deck-options.html

## Product semantics (enforced in pure code)

- **Readiness:** sufficient correct learning content to run a particular game; neither score nor mastery.
- **Last-session score (legacy 0–100):** performance in the last completed game. Do not add/subtract it as though it were accumulated points. Preserve historical score schema; migrate explicitly later.
- **Evidence state:** `not-assessed`, `recover`, `building`, or `repeated-success`. `repeated-success` is **not** a mastery guarantee or numeric recall probability and requires at least three detailed successful assessments on at least two calendar days **and** at least 24 hours between the latest and oldest verified success in the uninterrupted success run. The evidence day is calculated in an explicit IANA time zone; client screens use the same browser time zone as their visible calendar, while other callers default to UTC. A future account-level preferred time zone should be persisted for cross-device consistency.
- **Review schedule:** when a scheduled word is due. A future-due word is not brought into today's routine by a low score. If the schedule fails to load, suggestions fail closed, not `[]`.
- **Manual library status:** organization only; never creates real success evidence.
- **Calendar task status:** user-owned planning metadata; `done` does not credit learning or mutate word scores.
- **AI coach:** recommendations may be generated or explained using bounded, owner-scoped summaries only. No model has direct database write privilege or authority to set scores, schedule timestamps or evidence.

## Initial UX progression

1. **First contact:** 5-word batch, brief context and pronunciation; self-testing before showing the answer.
2. **Feedback:** immediate correct response, *why* it was correct, alternatives; mistakes return later in the session; no punishment or score hype.
3. **Delayed retrieval:** independent review at due dates; meaning and contextual use measured separately.
4. **Mixed practice:** interleave related meanings, confusable connectors, context and translation when source evidence supports it.
5. **Coach and calendar:** explain each suggestion; permit skip/reschedule without fake `mastered` or punitive streak mechanics.

## Source and confidence limitations

- Version-3 final game snapshots provide meaning/context correctness, confidence and matching errors. Older results only provide scores; detailed errors remain `unknown`. No attempt is made to invent reaction time or assistance metrics.
- `learning_results` and `learning_sessions` are fetched through authenticated owner-scoped Supabase RLS, never a browser service role. Queries are paginated and bounded over 180 days; incomplete history fails closed rather than silently truncating.
- No vocabulary-sense-specific recall evidence is available. The interface must not claim all POS/senses are mastered from the headword score.
- Time-per-word is a planning estimate, **not** personalized observed session duration.
- The `REVIEW_WRITE_V3_ENABLED` server flag remains OFF until its privileged transactional migration, concurrency/idempotence tests and live staging acceptance are complete; this patch does not falsely promise future reviews are being updated after every game.

## Safety / backward compatibility

- No DB mutation is required to add the evidence reader: existing `learning_results` and `learning_sessions` owner policies apply.
- The existing additive calendar staging migration remains included; it has owner RLS and zero overlap with session scoring.
- Guest recommendations are explicitly limited to local scores/schedules: there is no guest detailed-assessment ledger. Signed-in results remain **account-recorded**, not independent server-attested evidence, until a privileged completion writer is enabled and legacy client write grants are revoked after staging tests.
- Calendar editor retains a draft when save fails, allowing correction/retry rather than destroying unsaved input.
- v2 never rewrites legacy `score`, `assessment`, `senses`, manual groups, schedules or user data. Future score replacement needs explicit versioned backfill that is reversible.
- Wipe/drop/force-push/production deploy are not part of this patch.

## QA acceptance gates (required for staging push)

1. All backend + frontend Bun tests and TypeScript build.
2. Lint + repository audit + `git diff --check`.
3. Playwright new progress tests on Chromium desktop **and mobile** against a fresh localhost preview (`CI=1` prevents reusing a stale server).
4. Exact SHA256 of all added files, pinned original Git blobs and expected-only changed paths. Failed gate means **no commit / push**.
5. Staging QA: authenticated demo owner with real v3 game outcomes, zero-score failure, future-due review, wrong-user access rejection, offline/no-token error, calendar conflict, keyboard navigation, copy/move/undo, API rate limit. The demo's seeded schedules are not proof of learning.
6. Human design review: contrast/keyboard focus, screen reader labels, reduced motion, empty/skeleton/error states, small viewport overflow, comprehension and time-on-task. Need run real device / assisted-tech checks; automated tests cannot certify usability.
7. Security: Supabase owner RLS on calendar and results, no anonymous DML, no service key in Vite bundle, no model-generated SQL, no cross-account cache bleed, no production URLs in preview build.

## Next opt-in phase (not silently enabled)

Transactional `complete_learning_session_v3` server writer: validate final snapshot and revision; a single `learning_results.session_id` idempotency key; save word score *and* SRS transition atomically; cross-owner rejection; two-tabs race tests; retry idempotence; verified local/Cloud tests; then controlled staged flag rollout. Compare a validated FSRS implementation with current scheduler using real review logs; do not fabricate performance claims or use 4 seed cards to train personalized parameters.
