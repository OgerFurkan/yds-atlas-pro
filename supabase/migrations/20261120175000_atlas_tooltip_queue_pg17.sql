-- FB-LIVE-01 tooltip durable queue — CANDIDATE, NOT APPLIED
-- Requires separate PO approval before production migration or backfill.
-- Existing 3 Lexicon tables and audited claim/publish RPC remain unmodified.
-- No personal sentences, user IDs, email addresses, or translated guesses stored.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 170000
     OR pg_catalog.to_regrole('service_role') IS NULL
     OR pg_catalog.to_regclass('public.atlas_lexicon_entries') IS NULL
     OR pg_catalog.to_regprocedure('public.atlas_lexicon_claim_v1(text,text,text,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.atlas_lexicon_publish_v1(text,text,text,uuid,text,text,text,jsonb,jsonb,text)') IS NULL
  THEN RAISE EXCEPTION 'Atlas tooltip queue prerequisite mismatch; abort'; END IF;
  IF pg_catalog.to_regclass('public.atlas_tooltip_queue') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN ('atlas_tooltip_claim_v1','atlas_tooltip_finish_v1'))
  THEN RAISE EXCEPTION 'Atlas tooltip queue already/partially installed; abort'; END IF;
END $preflight$;

CREATE TABLE public.atlas_tooltip_queue (
  word_key text PRIMARY KEY CHECK (word_key ~ '^[a-z]+(''|-)?[a-z]*$'
                                    AND length(word_key) BETWEEN 2 AND 45),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','retry','ready','missing')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR
    (length(last_error_code) BETWEEN 1 AND 64 AND last_error_code ~ '^[A-Z_]+$')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT atlas_tooltip_queue_consistent_lease CHECK (
    (status='processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status<>'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);
CREATE INDEX atlas_tooltip_due_idx
  ON public.atlas_tooltip_queue(status,next_attempt_at,word_key)
  WHERE status IN ('pending','retry','processing');

ALTER TABLE public.atlas_tooltip_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atlas_tooltip_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.atlas_tooltip_queue TO service_role;

-- Atomic lease: SKIP LOCKED prevents duplicate work across Render instances.
-- Service role only; explicitly SECURITY INVOKER and no user-supplied table names.
CREATE FUNCTION public.atlas_tooltip_claim_v1(p_limit integer, p_token uuid)
RETURNS TABLE(word_key text, lease_token uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  IF p_token IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid tooltip lease request';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT q.word_key FROM public.atlas_tooltip_queue q
    WHERE (
      (q.status IN ('pending','retry') AND q.next_attempt_at <= now())
      OR (q.status='processing' AND q.lease_expires_at <= now())
    )
    ORDER BY q.next_attempt_at,q.word_key
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), leased AS (
    UPDATE public.atlas_tooltip_queue q
    SET status='processing', attempts=q.attempts+1, lease_token=p_token,
        lease_expires_at=now()+interval '150 seconds',updated_at=now(),
        last_error_code=NULL
    FROM candidates c WHERE q.word_key=c.word_key
    RETURNING q.word_key,q.lease_token
  )
  SELECT leased.word_key,leased.lease_token FROM leased;
END $fn$;

-- CAS completion: a stale worker can never overwrite a newer lease.
CREATE FUNCTION public.atlas_tooltip_finish_v1(
  p_word_key text,p_token uuid,p_outcome text,p_error_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE changed boolean := false;
BEGIN
  IF p_word_key IS NULL OR p_token IS NULL OR
     p_outcome NOT IN ('ready','missing','retry') OR
     (p_outcome='retry' AND (p_error_code IS NULL OR p_error_code !~ '^[A-Z_]{1,64}$'))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid tooltip completion'; END IF;
  UPDATE public.atlas_tooltip_queue q
  SET status=p_outcome,
      lease_token=NULL,lease_expires_at=NULL,
      last_error_code=CASE WHEN p_outcome='retry' THEN p_error_code ELSE NULL END,
      next_attempt_at=CASE WHEN p_outcome='retry'
        THEN now()+least(q.attempts,12)*interval '5 minutes'
        ELSE now() END,
      updated_at=now()
  WHERE q.word_key=p_word_key AND q.status='processing'
    AND q.lease_token=p_token AND q.lease_expires_at > now()
  RETURNING true INTO changed;
  RETURN coalesce(changed,false);
END $fn$;

REVOKE ALL ON FUNCTION public.atlas_tooltip_claim_v1(integer,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.atlas_tooltip_finish_v1(text,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_tooltip_claim_v1(integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.atlas_tooltip_finish_v1(text,uuid,text,text) TO service_role;
COMMIT;
