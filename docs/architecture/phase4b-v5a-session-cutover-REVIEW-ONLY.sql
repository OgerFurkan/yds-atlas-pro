-- PHASE 4B v5A: REVIEW ONLY; BREAKING CUTOVER, NEVER AUTO-APPLY.
-- Applying this before the backend switches to the service-only v5 writer WILL
-- BREAK existing authenticated session saves. See the v5A runbook.

DO $v5_cutover_guard$
BEGIN
  IF to_regprocedure('public.save_learning_session(uuid,jsonb,integer)') IS NULL OR
     to_regprocedure('public.save_learning_session_v5(uuid,uuid,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'missing legacy or v5 session writer' USING ERRCODE = '42501';
  END IF;
  IF NOT has_function_privilege('service_role',
      'public.save_learning_session_v5(uuid,uuid,jsonb,integer)', 'EXECUTE') OR
     has_function_privilege('authenticated',
      'public.save_learning_session_v5(uuid,uuid,jsonb,integer)', 'EXECUTE') OR
     has_function_privilege('anon',
      'public.save_learning_session_v5(uuid,uuid,jsonb,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'unsafe v5 function grants' USING ERRCODE = '42501';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.learning_sessions', 'INSERT') OR
     NOT has_table_privilege('service_role', 'public.learning_sessions', 'UPDATE') OR
     NOT has_table_privilege('service_role', 'public.learning_sessions', 'SELECT') THEN
    RAISE EXCEPTION 'service role session-table access not ready' USING ERRCODE = '42501';
  END IF;
END;
$v5_cutover_guard$;

-- Stop bypassing the Bun validation and revision CAS by direct authenticated
-- table writes or direct calls to the existing invoker RPC.
revoke execute on function public.save_learning_session(uuid,jsonb,integer)
  from PUBLIC, anon, authenticated;
revoke insert, update on table public.learning_sessions
  from PUBLIC, anon, authenticated;

-- Preserve owner-scoped SELECT: the Bun API still uses the user JWT to read
-- each account's task. RLS remains enabled and unchanged.
-- Neither this cutover nor the v4 cutover secures other direct progress DML
-- (e.g. public.words.score, daily_word_completions, completed_goal_days).
