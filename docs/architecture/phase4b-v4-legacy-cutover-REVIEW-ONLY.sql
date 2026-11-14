-- PHASE 4B V4 / REVIEW ONLY / DO NOT RUN IN STAGING OR PRODUCTION.
-- This is a BREAKING CUTOVER, not a standalone migration or auto-deploy step.
-- Apply ONLY under a coordinated maintenance window once the v3 service-role
-- writer is deployed and verified. Before cutover, legacy completion must still work.
-- After cutover, an API server with REVIEW_WRITE_V3_ENABLED=false will FAIL to
-- complete sessions. This fail-closed outcome is intentional; do not undo grants
-- casually, as re-enabling them exposes the direct-client completion bypass.
-- This overlay does not alter, drop, or replace the original function's body.

DO $review_cutover_guard$
BEGIN
  IF to_regprocedure('public.complete_learning_session(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'legacy completion function is missing';
  END IF;
  IF to_regprocedure('public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'v3 completion must be installed first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'complete_learning_session_v3'
      AND pg_get_function_identity_arguments(p.oid) =
        'p_owner_id uuid, p_id uuid, p_expected_revision integer, p_scores jsonb, p_ratings jsonb'
      AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'v3 RPC is missing or no longer SECURITY INVOKER';
  END IF;
  IF NOT has_function_privilege('service_role',
      'public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)', 'EXECUTE') OR
     has_function_privilege('authenticated',
      'public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)', 'EXECUTE') OR
     has_function_privilege('anon',
      'public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'v3 RPC execution grants are unsafe';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.learning_results', 'INSERT') OR
     NOT has_table_privilege('service_role', 'public.word_review_schedules', 'UPDATE') THEN
    RAISE EXCEPTION 'service role table grants do not support v3';
  END IF;
END;
$review_cutover_guard$;

-- Do NOT grant client access to the old completion RPC after cutover.
REVOKE EXECUTE ON FUNCTION public.complete_learning_session(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;

-- CRITICAL: an owner-scoped INSERT policy on learning_results by itself does
-- NOT prevent the user from fabricating a completion ledger record.
-- Only the privileged v3 writer should create ledger entries after cutover.
REVOKE INSERT ON TABLE public.learning_results FROM authenticated;

-- No grants on learning_sessions are changed here: save_learning_session
-- remains an invoker function that needs INSERT/UPDATE. This is a separate
-- integrity hardening task before any production rollout.
-- This is not approval to enable REVIEW_WRITE_V3_ENABLED.
