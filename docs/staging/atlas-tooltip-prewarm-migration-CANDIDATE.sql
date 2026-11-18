-- REVIEW CANDIDATE ONLY. NOT APPLIED TO ANY DATABASE.
-- Staging-only rollout after Product Owner's migration gate.
BEGIN;
CREATE TABLE IF NOT EXISTS public.atlas_sentence_tooltips (
  word_key text PRIMARY KEY
    CHECK (length(word_key) BETWEEN 2 AND 45 AND word_key ~ $rx$^[a-z]+([-'][a-z]+)?$$rx$),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','leased','retry','ready','choices','missing')),
  result jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  lease_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT atlas_tooltip_valid_lease CHECK ((status='leased')=(lease_token IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS atlas_sentence_tooltips_pending_idx
 ON public.atlas_sentence_tooltips (available_at,created_at)
 WHERE status IN ('pending','retry','leased');
ALTER TABLE public.atlas_sentence_tooltips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atlas_sentence_tooltips FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.atlas_sentence_tooltips TO service_role;
CREATE OR REPLACE FUNCTION public.atlas_tooltip_claim_v1(p_limit integer DEFAULT 2)
RETURNS TABLE(word_key text,lease_token uuid)
LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$
 WITH picked AS (
   SELECT t.word_key FROM public.atlas_sentence_tooltips t
   WHERE (t.status IN ('pending','retry') AND t.available_at<=now() AND t.attempts<8)
      OR (t.status='leased' AND t.lease_expires_at<now() AND t.attempts<8)
   ORDER BY t.available_at,t.created_at,t.word_key FOR UPDATE SKIP LOCKED
   LIMIT LEAST(GREATEST(COALESCE(p_limit,2),1),2)
 )
 UPDATE public.atlas_sentence_tooltips t SET
 status='leased',attempts=t.attempts+1,lease_token=gen_random_uuid(),
 lease_expires_at=now()+interval '90 seconds',updated_at=now()
 FROM picked WHERE t.word_key=picked.word_key
 RETURNING t.word_key,t.lease_token;
$$;
REVOKE ALL ON FUNCTION public.atlas_tooltip_claim_v1(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_tooltip_claim_v1(integer) TO service_role;
COMMENT ON TABLE public.atlas_sentence_tooltips IS 'Server-only licensed tooltip word cache; no user sentences or IDs.';
COMMIT;

