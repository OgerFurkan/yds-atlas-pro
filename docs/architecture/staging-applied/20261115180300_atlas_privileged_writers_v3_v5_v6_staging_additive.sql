-- APPROVED 2026-11-15: STAGING ONLY, ADDITIVE privileged writer installation.
-- Verified QA source 911c7fc344632e0b6c42302a32561512b54266f4; no legacy revoke, no feature flags, no user data DML.
DO $atlas_guard$
BEGIN
  IF current_setting('server_version_num')::integer < 170000 THEN RAISE EXCEPTION 'Unexpected staging PostgreSQL major version'; END IF;
  IF to_regprocedure('public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)') IS NOT NULL OR to_regprocedure('public.save_learning_session_v5(uuid,uuid,jsonb,integer)') IS NOT NULL OR to_regprocedure('public.set_daily_goal_v6(uuid,integer)') IS NOT NULL THEN RAISE EXCEPTION 'Privileged writer already installed - no overwrite permitted'; END IF;
  IF to_regprocedure('public.complete_learning_session(uuid,jsonb)') IS NULL OR to_regprocedure('public.save_learning_session(uuid,jsonb,integer)') IS NULL THEN RAISE EXCEPTION 'Existing legacy writers missing'; END IF;
  IF NOT has_function_privilege('authenticated','public.complete_learning_session(uuid,jsonb)','EXECUTE') OR NOT has_function_privilege('authenticated','public.save_learning_session(uuid,jsonb,integer)','EXECUTE') THEN RAISE EXCEPTION 'Existing writer permissions changed'; END IF;
  IF NOT has_table_privilege('service_role','public.learning_results','INSERT') OR NOT has_table_privilege('service_role','public.learning_sessions','UPDATE') OR NOT has_table_privilege('service_role','public.word_review_schedules','INSERT') OR NOT has_table_privilege('service_role','public.profiles','UPDATE') THEN RAISE EXCEPTION 'service_role table grants incomplete'; END IF;
END;
$atlas_guard$;

-- SOURCE docs/architecture/phase4b-v3-atomic-completion-DRAFT.sql blob fa41affe209e5469c280cafd5808c217f6679e7d
-- PHASE 4B V3 / REVIEW ONLY / DO NOT EXECUTE AUTOMATICALLY.
-- STAGING CANDIDATE: first test on an isolated database with PGlite and full migration history.
-- Compatibility: additive service_role-only RPC. Legacy complete_learning_session remains intact.
-- Backend REVIEW_WRITE_V3_ENABLED defaults to false until migration, tests and cutover.
-- For eventual production cutover, old client-callable completion RPC must be retired separately.
-- A function is a single PostgreSQL transaction; any failure rolls back scores, SRS and progress.

create or replace function public.complete_learning_session_v3(
  p_owner_id uuid,
  p_id uuid,
  p_expected_revision integer,
  p_scores jsonb,
  p_ratings jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  task public.learning_sessions%rowtype;
  existing jsonb;
  accepted jsonb;
  v_word jsonb;
  v_word_id uuid;
  v_assessment jsonb;
  v_score integer;
  v_expected_score integer;
  v_rating text;
  v_expected_rating text;
  v_version integer;
  v_count integer;
  v_required_rating_count integer;
  v_match integer;
  v_meaning numeric;
  v_context numeric;
  v_conf_meaning integer;
  v_conf_context integer;
  v_previous public.word_review_schedules%rowtype;
  v_reps integer;
  v_lapses integer;
  v_interval integer;
  v_ease numeric;
  v_due timestamptz;
  v_last timestamptz;
  v_now timestamptz := now();
  v_today date;
  v_goal integer;
begin
  if p_owner_id is null or p_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'invalid owner, session or revision' using errcode = '22023';
  end if;
  -- This function must be granted to service_role ONLY. Never trust a browser-supplied owner.
  select scores into existing from public.learning_results
    where session_id = p_id and user_id = p_owner_id;
  if found then return existing; end if;

  select * into task from public.learning_sessions
    where id = p_id and user_id = p_owner_id for update;
  if not found then raise exception 'session not found' using errcode = '42501'; end if;
  -- Recheck idempotency AFTER obtaining the session row lock (two requests may race).
  select scores into existing from public.learning_results
    where session_id = p_id and user_id = p_owner_id;
  if found then return existing; end if;

  if task.revision <> p_expected_revision then
    raise exception 'session revision conflict' using errcode = '40001';
  end if;
  if task.completed_at is not null or task.snapshot->>'phase' <> 'complete' or
     task.snapshot->>'tutorial' <> 'false' or
     jsonb_typeof(task.snapshot->'queue') <> 'array' or
     jsonb_array_length(task.snapshot->'queue') <> 0 or
     jsonb_typeof(task.snapshot->'words') <> 'array' then
    raise exception 'unfinished or invalid session' using errcode = '22023';
  end if;
  v_version := (task.snapshot->>'version')::integer;
  if v_version not in (2,3) then raise exception 'unknown game version' using errcode = '22023'; end if;
  v_count := jsonb_array_length(task.snapshot->'words');
  -- Keep CASE outside the IF condition so the PL/pgSQL condition is unambiguous.
  v_required_rating_count := case when v_version = 3 then v_count else 0 end;
  if v_count < 1 or v_count > 100 or
     jsonb_typeof(p_scores) <> 'array' or jsonb_array_length(p_scores) <> v_count or
     jsonb_typeof(p_ratings) <> 'array' or
     jsonb_array_length(p_ratings) <> v_required_rating_count then
    raise exception 'invalid scores or ratings shape' using errcode = '22023';
  end if;
  if (select count(distinct x.id) from jsonb_to_recordset(p_scores) as x(id uuid, score integer)) <> v_count or
     (select count(distinct x.id) from jsonb_to_recordset(task.snapshot->'words') as x(id uuid)) <> v_count or
     (v_version = 3 and
       (select count(distinct x.id) from jsonb_to_recordset(p_ratings) as x(id uuid, rating text)) <> v_count) then
    raise exception 'duplicate or missing word' using errcode = '22023';
  end if;

  -- Lock all referenced words in stable ID order. Different completed sessions
  -- editing the same word serialize, preventing lost SRS updates/deadlocks.
  perform w.id from public.words w
    where w.user_id = p_owner_id and w.id in (
      select x.id from jsonb_to_recordset(p_scores) as x(id uuid, score integer)
    ) order by w.id for update;
  if (select count(*) from public.words w where w.user_id = p_owner_id and w.id in (
    select x.id from jsonb_to_recordset(p_scores) as x(id uuid, score integer)
  )) <> v_count then
    raise exception 'word is missing or does not belong to owner' using errcode = '23503';
  end if;

  -- Recalculate every submitted score and rating from the locked stored snapshot.
  -- This prevents the backend payload from trusting modified/stale client results.
  for v_word in select value from jsonb_array_elements(task.snapshot->'words') loop
    v_word_id := (v_word->>'id')::uuid;
    select x.score into v_score from jsonb_to_recordset(p_scores)
      as x(id uuid, score integer) where x.id = v_word_id;
    if not found or v_score is null or v_score < 0 or v_score > 100 then
      raise exception 'missing or invalid score' using errcode = '22023';
    end if;
    if v_version = 2 then
      v_expected_score := greatest(0,least(100,
        (v_word->>'score')::integer + coalesce((task.snapshot->'scoreChanges'->>v_word_id::text)::integer, 0)));
    else
      v_assessment := task.snapshot->'assessment'->v_word_id::text;
      if jsonb_typeof(v_assessment) <> 'object' or
         v_assessment->>'matchingDone' <> 'true' or
         jsonb_typeof(v_assessment->'meaning') <> 'object' or
         jsonb_typeof(v_assessment->'context') <> 'object' or
         (v_assessment->'meaning'->>'correct') is null or
         (v_assessment->'context'->>'correct') is null then
        raise exception 'incomplete assessment' using errcode = '22023';
      end if;
      v_conf_meaning := (v_assessment->'meaning'->>'confidence')::integer;
      v_conf_context := (v_assessment->'context'->>'confidence')::integer;
      if v_assessment->'meaning'->>'correct' = 'true' and v_conf_meaning is null or
         v_assessment->'context'->>'correct' = 'true' and v_conf_context is null then
        raise exception 'missing confidence' using errcode = '22023';
      end if;
      if (v_conf_meaning is not null and v_conf_meaning not in (-10,0,20)) or
         (v_conf_context is not null and v_conf_context not in (-10,0,20)) then
        raise exception 'invalid confidence' using errcode = '22023';
      end if;
      v_match := greatest(0,20 - (v_assessment->>'matchingErrors')::integer * 10);
      v_meaning := case when v_assessment->'meaning'->>'correct' = 'true' then
        30 * case v_conf_meaning when 20 then 1.0 when 0 then 0.85 when -10 then 0.6 else 0 end else 0 end;
      v_context := case when v_assessment->'context'->>'correct' = 'true' then
        50 * case v_conf_context when 20 then 1.0 when 0 then 0.85 when -10 then 0.6 else 0 end else 0 end;
      v_expected_score := round(v_match + v_meaning + v_context);
      v_expected_rating := case
        when v_assessment->'meaning'->>'correct' <> 'true' or
             v_assessment->'context'->>'correct' <> 'true' then 'again'
        when (v_assessment->>'matchingErrors')::integer > 0 or
             v_conf_meaning = -10 or v_conf_context = -10 then 'hard'
        when v_conf_meaning = 20 and v_conf_context = 20 then 'easy'
        else 'good' end;
      select x.rating into v_rating from jsonb_to_recordset(p_ratings)
        as x(id uuid, rating text) where x.id = v_word_id;
      if not found or v_rating is distinct from v_expected_rating then
        raise exception 'rating does not match stored assessment' using errcode = '22023';
      end if;
    end if;
    if v_score is distinct from v_expected_score then
      raise exception 'score does not match stored assessment' using errcode = '22023';
    end if;
  end loop;

  -- The learning_results primary key is the permanent exactly-once ledger.
  accepted := p_scores;
  -- Preserve mastery from a later review when an older session completes late.
  -- The schedule loop below applies the same staleness rule to SRS fields.
  update public.words w set score = x.score, updated_at = v_now
    from jsonb_to_recordset(accepted) as x(id uuid,score integer)
    where w.user_id = p_owner_id and w.id = x.id
      and not exists (
        select 1 from public.word_review_schedules s
          where s.user_id = p_owner_id and s.word_id = w.id
            and s.last_reviewed_at > task.updated_at
      );
  insert into public.learning_results(session_id,user_id,scores)
    values(p_id,p_owner_id,accepted);

  if v_version = 3 then
    for v_word in select value from jsonb_array_elements(p_ratings) loop
      v_word_id := (v_word->>'id')::uuid;
      v_rating := v_word->>'rating';
      select * into v_previous from public.word_review_schedules
        where user_id = p_owner_id and word_id = v_word_id for update;
      if not found then
        v_previous.repetitions := 0;
        v_previous.lapses := 0;
        v_previous.interval_days := 0;
        v_previous.ease_factor := 2.50;
        v_previous.last_reviewed_at := null;
      end if;
      -- Older completed sessions cannot move a word's newer schedule backwards.
      if v_previous.last_reviewed_at is not null and
         v_previous.last_reviewed_at > task.updated_at then
        continue;
      end if;
      v_last := v_now;
      if v_rating = 'again' then
        v_reps := 0;
        v_lapses := v_previous.lapses + 1;
        v_interval := 0;
        v_ease := greatest(1.30,v_previous.ease_factor - 0.20);
        v_due := v_now + interval '10 minutes';
      else
        v_reps := v_previous.repetitions + 1;
        v_lapses := v_previous.lapses;
        v_ease := least(2.80,greatest(1.30,v_previous.ease_factor +
          case v_rating when 'easy' then 0.15 when 'hard' then -0.15 else 0 end));
        v_interval := case when v_previous.interval_days = 0 then
          case when v_rating = 'easy' then 3 else 1 end
        else least(36500,greatest(1,ceil(v_previous.interval_days *
          case v_rating when 'hard' then 1.2 when 'good' then v_previous.ease_factor
          else v_previous.ease_factor * 1.3 end)::integer)) end;
        v_due := v_now + make_interval(days => v_interval);
      end if;
      insert into public.word_review_schedules
        (user_id,word_id,repetitions,lapses,interval_days,ease_factor,due_at,last_reviewed_at)
      values (p_owner_id,v_word_id,v_reps,v_lapses,v_interval,v_ease,v_due,v_last)
      on conflict(user_id,word_id) do update set
        repetitions=excluded.repetitions, lapses=excluded.lapses,
        interval_days=excluded.interval_days,ease_factor=excluded.ease_factor,
        due_at=excluded.due_at,last_reviewed_at=excluded.last_reviewed_at;
    end loop;
  end if;

  v_today := (v_now at time zone 'Europe/Istanbul')::date;
  insert into public.daily_word_completions(user_id,day,word_id)
    select p_owner_id,v_today,x.id from jsonb_to_recordset(accepted)
      as x(id uuid,score integer) on conflict do nothing;
  select daily_goal into v_goal from public.profiles where user_id = p_owner_id;
  v_goal := coalesce(v_goal,20);
  if (select count(*) from public.daily_word_completions
      where user_id = p_owner_id and day = v_today) >= v_goal then
    insert into public.completed_goal_days(user_id,day,goal)
      values(p_owner_id,v_today,v_goal) on conflict do nothing;
  end if;
  update public.learning_sessions set completed_at = v_now,
    revision = revision + 1,
    snapshot = jsonb_set(snapshot,'{saved}','true'::jsonb),updated_at = v_now
    where id = p_id and user_id = p_owner_id;
  return accepted;
end;
$function$;

-- Supabase may grant function execute explicitly to multiple roles by default.
revoke all on function public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)
  to service_role;

-- Before any rollout: check this function is INVOKER and only service_role can execute.
-- Production requires a separate coordinated cutover: retire the older
-- client-callable complete_learning_session RPC after backend v3 is enabled.

-- END SOURCE

-- SOURCE docs/architecture/phase4b-v5a-session-writer-REVIEW-ONLY.sql blob 7d3f592ac7e462afa07f51f6e418c21d91d79a15
-- PHASE 4B v5A: REVIEW-ONLY, NOT AN APPLIED MIGRATION.
-- This function alone is additive and does NOT revoke the legacy client save path.
-- A coordinated backend cutover plus separate privilege revocations are mandatory.
-- Never expose the service_role secret in a browser or mobile client.

create or replace function public.save_learning_session_v5(
  p_owner_id uuid, p_id uuid, p_snapshot jsonb, p_expected_revision integer
) returns integer
language plpgsql
security invoker
set search_path = ''
as $v5_save$
declare
  v_revision integer;
begin
  if p_owner_id is null or p_id is null or
     p_expected_revision is null or p_expected_revision < 0 or
     jsonb_typeof(p_snapshot) is distinct from 'object' or
     p_snapshot->>'id' is distinct from p_id::text or
     p_snapshot->>'tutorial' is distinct from 'false' then
    raise exception 'invalid owner, session or snapshot' using errcode = '22023';
  end if;

  -- The Bun API MUST authenticate and schema-validate the game before calling
  -- this service-only function. A privileged service_role caller is trusted
  -- to pass the authenticated ctx.userId (never a browser-supplied owner).
  if p_expected_revision = 0 then
    insert into public.learning_sessions(id, user_id, snapshot)
      values(p_id, p_owner_id, p_snapshot)
      on conflict do nothing
      returning revision into v_revision;
  else
    update public.learning_sessions
       set snapshot = p_snapshot, revision = revision + 1, updated_at = now()
     where id = p_id and user_id = p_owner_id
       and revision = p_expected_revision and completed_at is null
     returning revision into v_revision;
  end if;

  if v_revision is null then
    raise exception 'session revision conflict' using errcode = '40001';
  end if;
  return v_revision;
end;
$v5_save$;

-- Explicitly prevent default PUBLIC EXECUTE on new public functions.
revoke all on function public.save_learning_session_v5(uuid,uuid,jsonb,integer)
  from PUBLIC, anon, authenticated;
grant execute on function public.save_learning_session_v5(uuid,uuid,jsonb,integer)
  to service_role;

-- END SOURCE

-- SOURCE docs/architecture/phase4b-v5cc-goal-writer-REVIEW-ONLY.sql blob d154a53605a7c01e2c2238927cd5348e7dfe7234
-- PHASE 4B v5C-C / ADDITIVE SQL REVIEW ONLY; DO NOT AUTO-APPLY.
-- Install to staging only as part of a coordinated authenticated backend cutover.
-- Existing public.set_daily_goal stays intact until GOAL_WRITE_V6_ENABLED works.
-- Avoid SECURITY DEFINER: service_role is the only permitted EXECUTE role.

create or replace function public.set_daily_goal_v6(p_owner_id uuid, p_goal integer)
returns integer
language plpgsql security invoker set search_path = ''
as $v6$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if p_owner_id is null or p_goal is null or p_goal < 10 or p_goal > 100 or p_goal % 10 <> 0 then
    raise exception 'invalid owner or goal' using errcode = '22023';
  end if;
  -- Caller is server-side service_role. Bun must derive owner from authenticated ctx.userId.
  insert into public.profiles(user_id,daily_goal) values (p_owner_id,p_goal)
    on conflict(user_id) do update set daily_goal=excluded.daily_goal;
  if (select count(*) from public.daily_word_completions
      where user_id=p_owner_id and day=v_today) >= p_goal then
    insert into public.completed_goal_days(user_id,day,goal)
      values (p_owner_id,v_today,p_goal) on conflict do nothing;
  end if;
  return p_goal;
end;
$v6$;

-- Service-role grants are additive; no client privileges are granted.
grant usage on schema public to service_role;
grant select,insert,update on public.profiles to service_role;
grant select on public.daily_word_completions to service_role;
grant insert on public.completed_goal_days to service_role;
revoke all on function public.set_daily_goal_v6(uuid,integer)
  from PUBLIC,anon,authenticated;
grant execute on function public.set_daily_goal_v6(uuid,integer) to service_role;

-- END SOURCE

DO $atlas_post$
DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)'::regprocedure,'public.save_learning_session_v5(uuid,uuid,jsonb,integer)'::regprocedure,'public.set_daily_goal_v6(uuid,integer)'::regprocedure] LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid=f::oid) THEN RAISE EXCEPTION 'Writer must be SECURITY INVOKER: %',f; END IF;
    IF NOT has_function_privilege('service_role',f::oid,'EXECUTE') OR has_function_privilege('authenticated',f::oid,'EXECUTE') OR has_function_privilege('anon',f::oid,'EXECUTE') THEN RAISE EXCEPTION 'Unsafe writer EXECUTE ACL: %',f; END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated','public.complete_learning_session(uuid,jsonb)','EXECUTE') OR NOT has_function_privilege('authenticated','public.save_learning_session(uuid,jsonb,integer)','EXECUTE') OR NOT has_table_privilege('authenticated','public.learning_results','INSERT') THEN RAISE EXCEPTION 'Legacy compatibility changed during additive install'; END IF;
END;
$atlas_post$;
