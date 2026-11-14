-- PHASE 4B v5C-C / REVIEW ONLY; BREAKING, NEVER AUTO-APPLY.
-- REQUIRES: v3 and v5 writers + v6 goal writer installed and verified IN STAGING,
-- backend REVIEW_WRITE_V3_ENABLED=true, SESSION_SAVE_V5_ENABLED=true,
-- GOAL_WRITE_V6_ENABLED=true, and healthy authenticated end-to-end tests.
-- Do NOT run this SQL alone; otherwise old deployed clients will fail closed.
-- Intentionally does NOT change public.words or public.apply_word_scores;
-- manual library status currently depends on words.score. Treat scores as
-- user-controlled SELF-ASSESSMENT until separately modeled/secured.
-- This overlay blocks fabricated completion ledgers and user session writes.

DO $guard$
BEGIN
  IF to_regprocedure('public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)') IS NULL OR
     to_regprocedure('public.save_learning_session_v5(uuid,uuid,jsonb,integer)') IS NULL OR
     to_regprocedure('public.set_daily_goal_v6(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'v3/v5/v6 privileged writers must be present first' USING ERRCODE='42501';
  END IF;
  IF NOT has_function_privilege('service_role','public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)','EXECUTE') OR
      NOT has_function_privilege('service_role','public.save_learning_session_v5(uuid,uuid,jsonb,integer)','EXECUTE') OR
      NOT has_function_privilege('service_role','public.set_daily_goal_v6(uuid,integer)','EXECUTE') OR
      has_function_privilege('authenticated','public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)','EXECUTE') OR
      has_function_privilege('authenticated','public.save_learning_session_v5(uuid,uuid,jsonb,integer)','EXECUTE') OR
      has_function_privilege('authenticated','public.set_daily_goal_v6(uuid,integer)','EXECUTE') OR
      has_function_privilege('anon','public.set_daily_goal_v6(uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'unsafe privileged RPC grants' USING ERRCODE='42501';
  END IF;
  IF NOT has_table_privilege('service_role','public.completed_goal_days','INSERT') OR
     NOT has_table_privilege('service_role','public.daily_word_completions','INSERT') OR
     NOT has_table_privilege('service_role','public.learning_results','INSERT') OR
     NOT has_table_privilege('service_role','public.learning_sessions','UPDATE') THEN
    RAISE EXCEPTION 'service_role writers lack required table grants' USING ERRCODE='42501';
  END IF;
END;
$guard$;

revoke execute on function public.complete_learning_session(uuid,jsonb)
  from PUBLIC,anon,authenticated;
revoke execute on function public.save_learning_session(uuid,jsonb,integer)
  from PUBLIC,anon,authenticated;
revoke execute on function public.set_daily_goal(integer)
  from PUBLIC,anon,authenticated;
revoke insert on public.learning_results from PUBLIC,anon,authenticated;
revoke insert on public.daily_word_completions from PUBLIC,anon,authenticated;
revoke insert on public.completed_goal_days from PUBLIC,anon,authenticated;
revoke insert,update on public.learning_sessions from PUBLIC,anon,authenticated;

-- Owner-scoped SELECT policies remain unchanged; existing legacy clients must
-- no longer be used after this coordinated breaking cutover.
