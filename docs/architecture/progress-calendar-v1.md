# Atlas İlerleme Merkezi — Stage 1 (staging)

## User-facing contract

- Global coach considers the entire active library, not `Gün N` buckets.
- Priority is scheduled due reviews, low previous **assessment scores** (1–39), strengthening (40–79), then unseen words (0). Only ready words can launch a game.
- Review schedules **with future dueAt** are never pulled forward. Missing schedules are not considered due.
- Each day in the calendar combines three different classes of information: actual server-confirmed daily word completions; scheduled review dates; editable manual/coach-suggested entries.
- A user marking an entry `done` changes **only the calendar event**, not any word score or verified learning completion.
- Manual plans can be moved by desktop drag-and-drop or via editing the date; copied to an in-app clipboard and pasted onto another selected day.
- For authenticated users calendar events persist in `public.study_calendar_entries` guarded by owner RLS, optimistic `revision` checks and explicit grants. Guest entries remain browser-local, separate from authenticated data.
- Coach suggestions do not auto-write; the user explicitly chooses `Takvime ekle` or `Çalış`.
- Coach tasks launch the existing game by word IDs, without a fictional `Gün 1` assignment.

## Boundaries / follow-up

- This is a deterministic explainable planner, **not an LLM trained on user data**.
- The current account API's `daily_word_completions` and owner-scoped `learning_results.scores` provide verified daily word history. Repeated low scores are a weakness signal, **not** a fabricated count of wrong answers. Detailed correctness per question still requires a separate event pipeline.
- Real game completion -> cloud spaced repetition writer and verified weakness history remain a separate, gated backend project. Until implemented, dueAt records only change when existing authorized backend mechanisms update them.
- Coach-origin calendar entries store a human-readable snapshot of recommended words in notes, not an unvalidated cross-account foreign-key array. Future work: server-validated task-word join, recurring rules, calendar export/import (ICS), notifications, scenario forecasts, AI explanations bounded by data provenance.
- Do not auto-merge this staging branch into `main` or run the migration against production.

## Validation gate

1. Staging migration applied as `20261114231724_atlas_study_calendar_staging` (the exact migration-history version). Verify `relrowsecurity`, owner policies, grants, and a read-only verification query.
2. User local staging worktree must match the expected Git HEAD and blob hashes; run `bun test backend/tests frontend/tests/unit`, `bun run build`, `bun run lint`, repository audit and `git diff --check`.
3. Deploy the new staging commit ONLY to Vercel staging. No Render deploy needed (frontend uses direct Supabase Data API with RLS).
4. Sign into demo and test: history can be empty without manufactured completions; due suggestions reflect four existing due records; a plan can be saved, copied, moved, and deleted without affecting `words.score`; test guest isolation and mobile editing.
