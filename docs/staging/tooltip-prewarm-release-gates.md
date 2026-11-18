# YDS Atlas Pro | Automatic sentence tooltip prewarming | 2026-11-18

Scope: isolated lightweight dictionary cache; existing 5-example Lexicon and scores unchanged.

Implemented: successful word create, edit, import, and Lexicon resolve enqueue deduplicated tokens.
Backend startup automatically scans preexisting English sentences in 50-word pages.
Worker processes two queued terms per 30 seconds using private atomic DB leases and fixed licensed dictionary.
Conservative lemma lookup, distinct noun/verb choices, no fabricated Turkish definitions.
Cached source attribution and expiry; no user sentences, user IDs, emails or tokens in shared table.
Frontend reads cache-only batched meanings; pre-answer protection remains.

Rollout requires specific staging migration review and authorization:
1. Review docs/staging/atlas-tooltip-prewarm-migration-CANDIDATE.sql; DO NOT apply to production.
2. Apply to staging Supabase only, validate RLS (no anon/auth access), grants and claim RPC.
3. Deploy exact reviewed commit to staging Render and validate Preview CORS.
4. Enable ATLAS_TOOLTIP_PREWARM_ENABLED=true on staging backend, then VITE_TOOLTIP_PREWARM_UI_ENABLED=true on the staging frontend (both default OFF).
5. Verify automatic backfill, budget, license, ambiguous/missing statuses and desktop/mobile authenticated E2E.

Rollback: disable flag; the new cache is entirely separate from personal words and learning progress.
Baseline: 205 staging sentences and 944 distinct raw English word forms (safe token count lower).
Limits: rate cap 200 worker lookups/hour; external dictionary cannot guarantee all meanings.
Production release remains a separate approval. No migrations or env changes in this PR.
