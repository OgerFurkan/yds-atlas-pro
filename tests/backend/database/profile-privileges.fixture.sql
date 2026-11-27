-- Run within a caller-owned transaction on the synthetic database only.
-- The caller rolls back the candidate grant change and all fixture rows.
-- Native PG17 setup uses the ownership suite's synthetic auth bootstrap, followed by
-- 20261110161008_atlas_cloud_foundation.sql and 20261124023000_authoritative_learning.sql.
-- Send BEGIN, this file and ROLLBACK to psql -X -v ON_ERROR_STOP=1 in the isolated container.
set local plpgsql.check_asserts = on;
set local atlas_test.alice = '01000000-0000-4000-8000-000000000001';
set local atlas_test.bob   = '01000000-0000-4000-8000-000000000002';
set local atlas_test.word  = '01000000-0000-4000-8000-000000000003';
set local atlas_test.task  = '01000000-0000-4000-8000-000000000004';
insert into auth.users(id) values
  (current_setting('atlas_test.alice')::uuid), (current_setting('atlas_test.bob')::uuid);
insert into public.words(id, user_id, word) values
  (current_setting('atlas_test.word')::uuid, current_setting('atlas_test.bob')::uuid, 'Observe');
insert into public.daily_word_completions(user_id, day, word_id)
  select current_setting('atlas_test.bob')::uuid, (now() at time zone 'Europe/Istanbul')::date,
         gen_random_uuid() from generate_series(1, 19);

set local session authorization authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.alice'), true);
savepoint baseline_profile_writes;
do $baseline$
declare
  owner_id uuid := auth.uid();
  written public.profiles%rowtype;
begin
  assert current_user = 'authenticated' and session_user = current_user;
  assert row_security_active('public.profiles');
  assert has_table_privilege(current_user, 'public.profiles', 'INSERT');
  assert has_table_privilege(current_user, 'public.profiles', 'UPDATE'), 'baseline UPDATE';
  assert owner_id = current_setting('atlas_test.alice')::uuid;
  assert exists (select from pg_policies where schemaname = 'public' and tablename = 'profiles'
    and policyname = 'profiles_owner' and cmd = 'ALL' and 'authenticated' = any(roles));
  assert not exists (select from public.profiles where user_id = owner_id);

  insert into public.profiles(user_id, daily_goal) values (owner_id, 30)
    returning * into strict written;
  assert written.user_id = owner_id and written.daily_goal = 30, 'baseline INSERT';

  update public.profiles set daily_goal = 50 where user_id = owner_id
    returning * into strict written;
  assert written.user_id = owner_id and written.daily_goal = 50, 'baseline UPDATE';

  insert into public.profiles(user_id, daily_goal) values (owner_id, 70)
    on conflict(user_id) do update set daily_goal = excluded.daily_goal
    returning * into strict written;
  assert written.user_id = owner_id and written.daily_goal = 70, 'baseline UPSERT';
end
$baseline$;
rollback to savepoint baseline_profile_writes;
release savepoint baseline_profile_writes;

set local session authorization postgres;
do $setup$ begin
  assert current_user = (select pg_get_userbyid(relowner) from pg_class where oid = 'public.profiles'::regclass),
    'candidate must be applied by fixture table owner, got ' || current_user;
  assert not exists (
    select from public.profiles
      where user_id in (current_setting('atlas_test.alice')::uuid, current_setting('atlas_test.bob')::uuid)
  ), 'candidate must start with both profiles absent';
end $setup$;
revoke insert, update on table public.profiles from authenticated;

set local session authorization authenticated;
do $owner$
begin
  assert current_user = 'authenticated' and session_user = current_user;
  assert row_security_active('public.profiles');
  -- Effective table and per-column checks include PUBLIC and inherited privileges.
  assert not has_any_column_privilege(current_user, 'public.profiles', 'INSERT'),
    'residual INSERT: ' || (select relacl::text from pg_class where oid = 'public.profiles'::regclass);
  assert not has_any_column_privilege(current_user, 'public.profiles', 'UPDATE'), 'residual UPDATE';
  begin
    insert into public.profiles(user_id, daily_goal) values (auth.uid(), 30);
    raise exception 'direct insert succeeded';
  exception when sqlstate '42501' then null;
  end;
  assert not exists (select from public.profiles), 'unexpected visible profile';
  assert public.set_daily_goal(40) = 40;
  assert (select daily_goal from public.profiles where user_id = auth.uid()) = 40;
  begin
    update public.profiles set daily_goal = 30 where user_id = auth.uid();
    raise exception 'direct update returned without a permission error';
  exception when sqlstate '42501' then null;
  end;
  begin
    insert into public.profiles(user_id, daily_goal) values (auth.uid(), 30)
      on conflict(user_id) do update set daily_goal = excluded.daily_goal;
    raise exception 'direct upsert returned without a permission error';
  exception when sqlstate '42501' then null;
  end;
  assert (select daily_goal from public.profiles where user_id = auth.uid()) = 40;
  assert public.set_daily_goal(50) = 50;
  begin
    perform public.set_daily_goal(55);
    raise exception 'invalid goal succeeded';
  exception when sqlstate '22023' then null;
  end;
  assert (select daily_goal from public.profiles) = 50;
end
$owner$;

select set_config('request.jwt.claim.sub', current_setting('atlas_test.bob'), true);
do $other_user$
begin
  assert current_user = 'authenticated' and session_user = current_user;
  assert auth.uid() = current_setting('atlas_test.bob')::uuid;
  assert not exists (select from public.profiles), 'unexpected visible profile';
  begin
    perform public.atlas_finish_learning_session(auth.uid(), current_setting('atlas_test.task')::uuid, 1);
    raise exception 'authenticated could call completion';
  exception when sqlstate '42501' then null;
  end;
end
$other_user$;

set local session authorization anon;
do $anonymous$
begin
  assert current_user = 'anon' and session_user = current_user;
  begin
    perform public.atlas_finish_learning_session(
      current_setting('atlas_test.bob')::uuid, current_setting('atlas_test.task')::uuid, 1);
    raise exception 'anon could call completion';
  exception when sqlstate '42501' then null;
  end;
end
$anonymous$;

set local session authorization atlas_assessment_api;
do $writer$
declare
  owner_id uuid := current_setting('atlas_test.bob')::uuid;
  task_id uuid := current_setting('atlas_test.task')::uuid;
  word_id uuid := current_setting('atlas_test.word')::uuid;
  snapshot jsonb := jsonb_build_object(
    'id', task_id, 'version', 3, 'tutorial', false, 'phase', 'complete',
    'queue', '[]'::jsonb, 'assessmentActions', '[]'::jsonb,
    'words', jsonb_build_array(jsonb_build_object('id', word_id, 'word', 'Observe')),
    'assessment', jsonb_build_object(word_id::text,
      '{"matchingDone":true,"matchingErrors":0,"meaning":{"correct":true,"confidence":0},"context":{"correct":true,"confidence":0}}'::jsonb));
  expected jsonb := jsonb_build_object('practiceOnly', false, 'scores',
    jsonb_build_array(jsonb_build_object('id', word_id, 'score', 88)));
begin
  assert current_user = 'atlas_assessment_api' and session_user = current_user;
  assert not (select rolsuper or rolbypassrls from pg_roles where rolname = current_user);
  assert public.atlas_store_learning_session(owner_id, task_id, snapshot, 0, true) = 1;
  assert public.atlas_finish_learning_session(owner_id, task_id, 1) = expected;
  assert public.atlas_finish_learning_session(owner_id, task_id, 1) = expected;
end
$writer$;

set local session authorization authenticated;
do $verify$
declare
  mutator regrole := 'atlas_learning_mutator'::regrole;
  routine regprocedure;
begin
  assert current_user = 'authenticated' and auth.uid() = current_setting('atlas_test.bob')::uuid, 'final reader identity';
  assert not exists (select from public.profiles), 'unexpected visible profile';
  assert (select count(*) from public.daily_word_completions) = 20;
  assert (select goal from public.completed_goal_days) = 20;
  assert (select score from public.words) = 88;
  assert (select count(*) from public.learning_results) = 1;
  assert (select revision from public.learning_sessions) = 2;
  assert has_column_privilege(mutator, 'public.profiles', 'user_id', 'INSERT');
  assert has_column_privilege(mutator, 'public.profiles', 'daily_goal', 'INSERT');
  assert has_column_privilege(mutator, 'public.profiles', 'daily_goal', 'UPDATE');
  foreach routine in array array[
    'public.set_daily_goal(integer)'::regprocedure,
    'public.atlas_store_learning_session(uuid,uuid,jsonb,integer,boolean)'::regprocedure,
    'public.atlas_finish_learning_session(uuid,uuid,integer)'::regprocedure
  ] loop
    assert (select prosecdef and proowner = mutator from pg_proc where oid = routine);
  end loop;
end
$verify$;
set local session authorization postgres;
