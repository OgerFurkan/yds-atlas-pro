-- Preserve the historical PRE plan without changing the legacy row.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists atlas_account.legacy_plan_imports (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source_revision integer not null check (source_revision > 0),
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  source_fingerprint bytea not null check (octet_length(source_fingerprint) = 32),
  first_command_id uuid not null
);
alter table atlas_account.legacy_plan_imports enable row level security;
revoke all on atlas_account.legacy_plan_imports from public, anon, authenticated, service_role;

do $bridge$
begin
  -- Fresh LOCAL installation has no historical PRE table.
  if to_regclass('public.daily_plan_states') is null then
    return;
  end if;
LOCK TABLE public.daily_plan_states, public.words IN SHARE MODE;
LOCK TABLE atlas_account.plans IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT FROM public.daily_plan_states s
    WHERE s.revision < 1 OR jsonb_typeof(s.payload) IS DISTINCT FROM 'object'
       OR s.payload - ARRAY['groupSize', 'assignments', 'excludedWordIds'] <> '{}'
       OR jsonb_typeof(s.payload->'groupSize') IS DISTINCT FROM 'number'
       OR (s.payload->>'groupSize') NOT IN ('10','20','30','40')
       OR jsonb_typeof(s.payload->'assignments') IS DISTINCT FROM 'array'
       OR jsonb_typeof(s.payload->'excludedWordIds') IS DISTINCT FROM 'array'
  ) THEN RAISE EXCEPTION 'Unmapped legacy plan data'; END IF;

  IF EXISTS (
    SELECT FROM public.daily_plan_states s
    WHERE jsonb_array_length(s.payload->'assignments')>60
       OR jsonb_array_length(s.payload->'excludedWordIds')>25000
  ) OR EXISTS (
    SELECT FROM public.daily_plan_states s, LATERAL jsonb_array_elements(s.payload->'assignments') g
    WHERE jsonb_typeof(g) IS DISTINCT FROM 'object'
       OR g - ARRAY['day','words'] <> '{}'
       OR jsonb_typeof(g->'day') IS DISTINCT FROM 'number'
       OR (g->>'day') !~ '^[0-9]{1,2}$' OR (g->>'day')::int NOT BETWEEN 1 AND 60
       OR jsonb_typeof(g->'words') IS DISTINCT FROM 'array'
  ) THEN RAISE EXCEPTION 'Invalid legacy plan groups'; END IF;

  IF EXISTS (
    SELECT FROM public.daily_plan_states s, LATERAL jsonb_array_elements(s.payload->'assignments') g
    WHERE jsonb_array_length(g->'words')>40
  ) OR EXISTS (
    SELECT FROM public.daily_plan_states s, LATERAL jsonb_array_elements(s.payload->'assignments') g
    GROUP BY s.user_id,g->'day' HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'Legacy plan group limits violated'; END IF;

CREATE TEMP TABLE atlas_legacy_plan_stage ON COMMIT DROP AS
SELECT s.user_id,s.revision,s.created_at,s.updated_at,
  sha256(convert_to(s.payload::text,'UTF8')) AS source_fingerprint,
  jsonb_build_object(
  'size',s.payload->'groupSize','groups',s.payload->'assignments','exclusions',s.payload->'excludedWordIds'
) AS document
FROM public.daily_plan_states s;

  IF EXISTS (
    SELECT FROM pg_temp.atlas_legacy_plan_stage s
    JOIN atlas_account.legacy_plan_imports r USING (user_id)
    WHERE (r.source_revision,r.source_created_at,r.source_updated_at,r.source_fingerprint)
       IS DISTINCT FROM (s.revision,s.created_at,s.updated_at,s.source_fingerprint)
       OR NOT EXISTS(SELECT FROM atlas_account.plans p WHERE p.user_id=s.user_id)
  ) THEN RAISE EXCEPTION 'Legacy plan changed after import'; END IF;

  -- A plan already imported may have advanced through the public RPC.
  DELETE FROM pg_temp.atlas_legacy_plan_stage s
  USING atlas_account.legacy_plan_imports r WHERE s.user_id=r.user_id;

  IF EXISTS (
    SELECT FROM (
      SELECT s.user_id, item.value AS raw_id FROM pg_temp.atlas_legacy_plan_stage s,
        LATERAL jsonb_array_elements_text(s.document->'exclusions') item
      UNION ALL
      SELECT s.user_id, item.value FROM pg_temp.atlas_legacy_plan_stage s,
        LATERAL jsonb_array_elements(s.document->'groups') g,
        LATERAL jsonb_array_elements_text(g->'words') item
    ) r LEFT JOIN public.words w ON w.user_id=r.user_id AND w.id=CASE
      WHEN r.raw_id ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      THEN r.raw_id::uuid END
    GROUP BY r.user_id,lower(r.raw_id) HAVING count(*)<>1 OR count(w.id)<>1
  ) THEN RAISE EXCEPTION 'Duplicate, missing or foreign legacy plan reference'; END IF;

  IF EXISTS (
    SELECT FROM pg_temp.atlas_legacy_plan_stage s
    JOIN atlas_account.plans p ON p.user_id=s.user_id
    WHERE p.revision IS DISTINCT FROM s.revision OR p.document IS DISTINCT FROM s.document
  ) THEN RAISE EXCEPTION 'Conflicting current private plan'; END IF;

INSERT INTO atlas_account.plans(user_id,revision,document,command_id,fingerprint)
SELECT user_id,revision,document,gen_random_uuid(),
  sha256(convert_to(jsonb_build_array(revision-1,document)::text,'UTF8'))
FROM pg_temp.atlas_legacy_plan_stage
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO atlas_account.legacy_plan_imports(
  user_id,source_revision,source_created_at,source_updated_at,source_fingerprint,first_command_id
)
SELECT s.user_id,s.revision,s.created_at,s.updated_at,s.source_fingerprint,p.command_id
FROM pg_temp.atlas_legacy_plan_stage s JOIN atlas_account.plans p USING (user_id);

end $bridge$;
commit;
