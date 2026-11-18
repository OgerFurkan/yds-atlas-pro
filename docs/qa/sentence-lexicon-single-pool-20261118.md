# Sentence tooltip prefetch — single Atlas Lexicon (staging draft)

**Scope:** Feature behind `ATLAS_FEEDBACK_LEXICON_ENABLED` and the separate
`ATLAS_SENTENCE_PREFETCH_WRITE_ENABLED=true` server-only opt-in.
The second `atlas_sentence_terms` table and associated SQL draft were removed.

## Source of truth
Existing public.atlas_lexicon_entries remains the **only persistent shared store**.
Fully tiered YDS word entries are never overwritten by tooltip prefetch.
Short, licensed tooltip-only entries use `part_of_speech='Tooltip'` and
`content.kind='atlas_tooltip_gloss_v1'`. They do not claim YDS 2/1/2 content.
LexiconStore.findCandidates excludes this namespace so Inspector, Resolver and
the 5-example content validator are unchanged.

## Flow
- On authorized word save/edit/import, enqueue unique English tokens from examples.
- When specifically enabled, a capped worker scans existing saved sentences on boot
  and processes at most five words per tick (3-minute interval).
- Check existing complete Lexicon records first, then a verified short glossary hit.
- Only then consult licensed FreeDictionaryAPI / Wiktionary English-to-Turkish data.
- A unique, source-validated candidate is written idempotently into the
  same shared table through existing `atlas_lexicon_claim_v1`/`atlas_lexicon_publish_v1` RPCs so every new entry has a revision ledger row. Direct table upsert is forbidden. Multiple POS options, absent translations, invalid source
  or source outage never create a claimed-verified meaning.
- Tooltip GET remains authenticated and blocked during an active saved assessment.
  The full original Inspector lookup remains the preferred source in the frontend.
- Personal word records, scores, learning sessions and existing Lexicon revisions are
  not modified by the worker.

## Release gates
- Default **OFF**. Do not set the write flag without explicit scoped approval.
- No new database migration; verify existing table RLS, service-role permissions,
  provenance and license requirements before enabling on staging.
- Run unit/TypeScript/browser/cloud CI and signed-in staging E2E.
- Measure unknown/ambiguous word coverage, external API rate and associated costs
  before any production proposal. The glossary is a word-form definition, not
  a context-certified translation.
- A transient error is retried after one hour in the same process; a restart reseeds from words.\n- Multi-worker deployments can duplicate external API calls even though rows
  remain deduplicated; deploy with one worker or add a distributed lease
  before high-volume production use.

## Rollback
Switch `ATLAS_SENTENCE_PREFETCH_WRITE_ENABLED` off and redeploy the approved
staging backend. The code does not change `main` or production automatically.
No destructive deletion of shared entries is part of rollback.
