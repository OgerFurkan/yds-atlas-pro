-- Personal copies refer to the publication revision that supplied their examples.
-- Later editorial changes and quarantines must not replace that attribution.
update public.words w
set content = jsonb_set(w.content, '{attribution}', jsonb_build_object(
  'license', r.provenance->>'license',
  'author', btrim(r.provenance->>'attribution'),
  'source', r.provenance->>'source'
))
from public.atlas_lexicon_entry_revisions r
where w.content->'lexicon'->>'entryId' = r.entry_id::text
  and w.content->'lexicon'->>'revision' = r.revision::text
  and not (w.content ? 'attribution')
  and r.provenance->>'license' = 'CC BY-SA 4.0'
  and length(btrim(r.provenance->>'attribution')) between 1 and 300
  and r.provenance->>'source' ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$';
