-- STAGING-ONLY DRAFT: requires explicit migration approval. NEVER run automatically.
-- Service-role-only, no user IDs, raw user sentences, or learning progress.
create table if not exists public.atlas_sentence_terms (
 word_key text primary key check(word_key ~ '^[a-z]+([''-][a-z]+)?$' and length(word_key)<=45),
 display_word text not null,
 lemma_key text not null,
 part_of_speech text,
 meanings jsonb not null default '[]'::jsonb check(jsonb_typeof(meanings)='array'),
 status text not null default 'pending'
  check(status in ('pending','ready','ambiguous','missing','error')),
 source text not null default 'pending',
 source_url text,
 license text,
 attempts integer not null default 0 check(attempts between 0 and 3),
 next_attempt_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.atlas_sentence_terms enable row level security;
revoke all on public.atlas_sentence_terms from PUBLIC,anon,authenticated;
create index if not exists atlas_sentence_terms_pending_idx
 on public.atlas_sentence_terms(next_attempt_at,updated_at,word_key)
 where status='pending';
