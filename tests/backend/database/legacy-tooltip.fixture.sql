-- Apply only before the cutover in the disposable LOCAL integration database.
WITH content AS (
 SELECT '{"kind":"atlas_tooltip_gloss_v1","word":"acquire","partOfSpeech":"Tooltip","originalPartOfSpeech":"Verb","meanings":["elde etmek"],"examples":[]}'::jsonb c,
 '{"kind":"atlas_tooltip_gloss_v1","license":"CC BY-SA 4.0","url":"https://en.wiktionary.org/wiki/acquire","provider":"Synthetic licensed fixture"}'::jsonb src
), entry AS (
 INSERT INTO public.atlas_lexicon_entries(word_key,part_of_speech,sense_key,content,provenance,digest)
 SELECT 'acquire','Tooltip',repeat('a',64),c,src,encode(sha256(convert_to(c::text,'utf8')),'hex') FROM content RETURNING *
) INSERT INTO public.atlas_lexicon_entry_revisions(entry_id,revision,status,action,digest,content,provenance)
SELECT id,revision,status,'published',digest,content,provenance FROM entry;
