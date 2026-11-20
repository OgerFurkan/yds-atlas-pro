-- FB-LIVE-01 — PRODUCTION CANDIDATE ONLY / NOT APPLIED.
-- Minimal exact subset of staging migration ledger 20261117230723
--   atlas_feedback_lexicon_admin_staging_v1_20261118
-- Original ledger statements[1] SHA256 (UTF-8):
--   696df6eb4bc24f9065d09db37f7699b2831953930e649edd322ed800998af7de
-- Staging catalog read-only check 2026-11-20: 3 Lexicon tables, claim/publish RPC.
-- Supersedes the UNAPPLIED readonly candidate under the same migration version.
-- DO NOT run both. Fails closed if any of the five objects already exist.
-- Explicit PO database-write approval, isolated PG17 execution, backup and PM
-- review are REQUIRED before execution. No personal data/seed/flag changes.
-- NOT included: atlas_usage_events, admin tables, review/admin RPC, writer migrations.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE existing_table_count integer;
DECLARE existing_fn_count integer;
BEGIN
 IF current_setting('server_version_num')::integer < 170000 THEN
   RAISE EXCEPTION 'FB-LIVE-01 requires inspected PostgreSQL 17 baseline';
 END IF;
 IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL
   OR to_regrole('service_role') IS NULL THEN
   RAISE EXCEPTION 'Expected Supabase role absent: STOP';
 END IF;
 SELECT count(*) INTO existing_table_count
 FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
   AND c.relname IN ('atlas_lexicon_entries','atlas_lexicon_jobs','atlas_lexicon_entry_revisions');
 SELECT count(*) INTO existing_fn_count
 FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('atlas_lexicon_claim_v1','atlas_lexicon_publish_v1');
 IF existing_table_count <> 0 OR existing_fn_count <> 0 THEN
   RAISE EXCEPTION 'Partial/already installed Atlas Lexicon: % tables, % RPCs; STOP',
     existing_table_count,existing_fn_count;
 END IF;
END $guard$;

-- Unmodified table columns/constraints from the inspected staging ledger.
CREATE TABLE public.atlas_lexicon_entries (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  word_key text NOT NULL CHECK (length(word_key) BETWEEN 1 AND 120),
  part_of_speech text NOT NULL CHECK (length(part_of_speech) BETWEEN 1 AND 32),
  sense_key text NOT NULL CHECK (sense_key ~ '^[0-9a-f]{64}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  status text NOT NULL DEFAULT 'machine_validated'
    CHECK (status IN ('machine_validated','human_reviewed','quarantined')),
  content jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(content)='object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_catalog.jsonb_typeof(provenance)='object'),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT atlas_lexicon_identity_unique UNIQUE (word_key,part_of_speech,sense_key)
);
CREATE INDEX atlas_lexicon_entries_word_status_idx ON public.atlas_lexicon_entries (word_key,status);
CREATE INDEX atlas_lexicon_entries_updated_idx ON public.atlas_lexicon_entries (updated_at DESC,id);

CREATE TABLE public.atlas_lexicon_jobs (
  word_key text NOT NULL CHECK (length(word_key) BETWEEN 1 AND 120),
  part_of_speech text NOT NULL CHECK (length(part_of_speech) BETWEEN 1 AND 32),
  sense_key text NOT NULL CHECK (length(sense_key) BETWEEN 1 AND 64),
  status text NOT NULL CHECK (status IN ('generating','ready','failed')),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR length(last_error_code) <= 64),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (word_key,part_of_speech,sense_key),
  CONSTRAINT atlas_lexicon_job_lease_consistent CHECK (
    (status = 'generating' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'generating' AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);
CREATE INDEX atlas_lexicon_jobs_expiry_idx
  ON public.atlas_lexicon_jobs (lease_expires_at) WHERE status = 'generating';

CREATE TABLE public.atlas_lexicon_entry_revisions (
  entry_id uuid NOT NULL REFERENCES public.atlas_lexicon_entries(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('machine_validated','human_reviewed','quarantined')),
  action text NOT NULL CHECK (action IN ('published','editorial_approved','quarantined')),
  actor_id uuid,
  reason_code text,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  content jsonb NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (entry_id, revision)
);

ALTER TABLE public.atlas_lexicon_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_lexicon_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_lexicon_entry_revisions ENABLE ROW LEVEL SECURITY;

-- No user/anonymous Data API access and no explicit permissive RLS policies.
REVOKE ALL ON TABLE public.atlas_lexicon_entries,public.atlas_lexicon_jobs,
 public.atlas_lexicon_entry_revisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.atlas_lexicon_entries TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.atlas_lexicon_jobs TO service_role;
GRANT SELECT,INSERT ON TABLE public.atlas_lexicon_entry_revisions TO service_role;

-- Copied functional behavior from staging ledger, including PK lease arbitration.
CREATE FUNCTION public.atlas_lexicon_claim_v1(
  p_word_key text,p_pos text,p_sense_key text,p_token uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE claimed boolean := false;
BEGIN
  IF p_word_key IS NULL OR length(p_word_key) NOT BETWEEN 1 AND 120 OR
     p_pos IS NULL OR length(p_pos) NOT BETWEEN 1 AND 32 OR
     p_sense_key IS NULL OR length(p_sense_key) NOT BETWEEN 1 AND 64 OR
     p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid lexicon lease identity';
  END IF;
  INSERT INTO public.atlas_lexicon_jobs AS job
    (word_key,part_of_speech,sense_key,status,lease_token,lease_expires_at,last_error_code,updated_at)
  VALUES
    (p_word_key,p_pos,p_sense_key,'generating',p_token,pg_catalog.clock_timestamp()+interval '180 seconds',NULL,pg_catalog.clock_timestamp())
  ON CONFLICT (word_key,part_of_speech,sense_key) DO UPDATE SET
    status='generating',lease_token=excluded.lease_token,
    lease_expires_at=excluded.lease_expires_at,
    last_error_code=NULL,updated_at=excluded.updated_at
  WHERE job.status <> 'generating' OR job.lease_expires_at <= pg_catalog.clock_timestamp()
  RETURNING true INTO claimed;
  RETURN COALESCE(claimed,false);
END;
$fn$;

-- Token-bound atomic publish; no overwrite of an existing Lexicon identity.
CREATE FUNCTION public.atlas_lexicon_publish_v1(
  p_word_key text,p_pos text,p_sense_key text,p_token uuid,
  p_entry_word text,p_entry_pos text,p_entry_sense text,
  p_content jsonb,p_provenance jsonb,p_digest text
) RETURNS SETOF public.atlas_lexicon_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE lease_row public.atlas_lexicon_jobs%ROWTYPE;
DECLARE stored public.atlas_lexicon_entries%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_word_key IS NULL OR p_entry_word IS NULL OR
     p_entry_pos IS NULL OR p_entry_sense IS NULL OR
     p_entry_sense !~ '^[0-9a-f]{64}$' OR p_digest !~ '^[0-9a-f]{64}$' OR
     p_content IS NULL OR pg_catalog.jsonb_typeof(p_content) <> 'object' OR
     p_provenance IS NULL OR pg_catalog.jsonb_typeof(p_provenance) <> 'object' OR
     p_content->>'word' IS DISTINCT FROM p_entry_word OR
     p_content->>'partOfSpeech' IS DISTINCT FROM p_entry_pos OR
     pg_catalog.jsonb_typeof(p_content->'meanings') IS DISTINCT FROM 'array' OR
     p_content->'meanings'->>0 IS NULL OR
     pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(p_entry_word),'[[:space:]]+',' ','g')) <> p_word_key OR
     (p_pos <> 'Unspecified' AND p_entry_pos <> p_pos) OR
     (p_sense_key <> 'unresolved' AND p_entry_sense <> p_sense_key) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid lexical content or identity';
  END IF;
  SELECT * INTO lease_row FROM public.atlas_lexicon_jobs
  WHERE word_key=p_word_key AND part_of_speech=p_pos AND sense_key=p_sense_key
    AND lease_token=p_token AND status='generating'
    AND lease_expires_at>pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO stored FROM public.atlas_lexicon_entries
  WHERE word_key=p_word_key AND part_of_speech=p_entry_pos AND sense_key=p_entry_sense
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.atlas_lexicon_entries
      (word_key,part_of_speech,sense_key,revision,status,content,provenance,digest)
    VALUES
      (p_word_key,p_entry_pos,p_entry_sense,1,'machine_validated',p_content,p_provenance,p_digest)
    ON CONFLICT (word_key,part_of_speech,sense_key) DO NOTHING
    RETURNING * INTO stored;
    IF NOT FOUND THEN
      SELECT * INTO stored FROM public.atlas_lexicon_entries
      WHERE word_key=p_word_key AND part_of_speech=p_entry_pos AND sense_key=p_entry_sense
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Concurrent lexicon publish';
      END IF;
    ELSE
      INSERT INTO public.atlas_lexicon_entry_revisions
      (entry_id,revision,status,action,actor_id,reason_code,digest,content,provenance)
      VALUES (stored.id,1,stored.status,'published',NULL,NULL,stored.digest,stored.content,stored.provenance);
    END IF;
  END IF;
  UPDATE public.atlas_lexicon_jobs
    SET status='ready',lease_token=NULL,lease_expires_at=NULL,
        last_error_code=NULL,updated_at=pg_catalog.clock_timestamp()
    WHERE word_key=p_word_key AND part_of_speech=p_pos AND sense_key=p_sense_key
      AND lease_token=p_token AND status='generating';
  RETURN NEXT stored;
END;
$fn$;

-- In the same transaction, remove Postgres' default function EXECUTE for PUBLIC.
REVOKE ALL ON FUNCTION public.atlas_lexicon_claim_v1(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.atlas_lexicon_publish_v1(text,text,text,uuid,text,text,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_lexicon_claim_v1(text,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.atlas_lexicon_publish_v1(text,text,text,uuid,text,text,text,jsonb,jsonb,text) TO service_role;

-- Post-flight negative ACL/RLS guard: any unexpected public privilege aborts.
DO $verify$
DECLARE public_count integer;
DECLARE role_name text;
DECLARE table_name text;
BEGIN
 SELECT count(*) INTO public_count FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
   AND c.relname IN ('atlas_lexicon_entries','atlas_lexicon_jobs','atlas_lexicon_entry_revisions')
   AND c.relkind='r' AND c.relrowsecurity;
 IF public_count <> 3 THEN
   RAISE EXCEPTION 'Lexicon RLS count %, expected 3', public_count;
 END IF;
 -- Deny every table privilege across both exposed web roles, not only SELECT.
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   FOREACH table_name IN ARRAY ARRAY[
     'atlas_lexicon_entries','atlas_lexicon_jobs','atlas_lexicon_entry_revisions'
   ] LOOP
     IF has_table_privilege(role_name, 'public.' || table_name,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
       RAISE EXCEPTION 'Lexicon table web role privilege unexpectedly present: % %',
         role_name, table_name;
     END IF;
   END LOOP;
 END LOOP;
 IF has_function_privilege('anon','public.atlas_lexicon_claim_v1(text,text,text,uuid)','EXECUTE') OR
    has_function_privilege('authenticated','public.atlas_lexicon_claim_v1(text,text,text,uuid)','EXECUTE') OR
    has_function_privilege('anon','public.atlas_lexicon_publish_v1(text,text,text,uuid,text,text,text,jsonb,jsonb,text)','EXECUTE') OR
    has_function_privilege('authenticated','public.atlas_lexicon_publish_v1(text,text,text,uuid,text,text,text,jsonb,jsonb,text)','EXECUTE') OR
    NOT has_function_privilege('service_role','public.atlas_lexicon_claim_v1(text,text,text,uuid)','EXECUTE') OR
    NOT has_function_privilege('service_role','public.atlas_lexicon_publish_v1(text,text,text,uuid,text,text,text,jsonb,jsonb,text)','EXECUTE') THEN
     RAISE EXCEPTION 'Lexicon ACL/role safety postcondition failed';
 END IF;
END $verify$;

-- Notify PostgREST only after schema creation (transaction commit delivers it).
SELECT pg_catalog.pg_notify('pgrst','reload schema');
COMMIT;
