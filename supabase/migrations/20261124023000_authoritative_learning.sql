-- Keep old scores, content, sessions and history. Only sessions started through
-- the new server protocol can earn points. Credentials are provisioned separately.
create role atlas_assessment_api login noinherit;
create role atlas_learning_mutator nologin noinherit;
grant atlas_learning_mutator to postgres with set true;

alter table public.learning_sessions
  add column assessment_protocol smallint check (assessment_protocol = 1);

revoke insert, update, delete, truncate, references, trigger on
  public.learning_sessions, public.learning_results,
  public.daily_word_completions, public.completed_goal_days
from public, anon, authenticated, service_role;
revoke insert, update, truncate, references, trigger on public.words
  from public, anon, authenticated, service_role;
revoke delete on public.words from public, anon, service_role;
grant insert(user_id, word, content), update(word, content) on public.words to authenticated;

revoke all on function public.apply_word_scores(jsonb),
  public.save_learning_session(uuid,jsonb,integer),
  public.complete_learning_session(uuid,jsonb)
from public, anon, authenticated, service_role;

create function public.guard_word_content() returns trigger
language plpgsql set search_path = '' as $$
declare editable constant text[] := array[
  'word', 'alternatives', 'meanings', 'usageNote', 'partOfSpeech', 'cefr',
  'examples', 'pronunciationUk', 'pronunciationUs', 'sourceUrl', 'lexicon'
];
begin
  if current_user = 'authenticated' then
    if (tg_op = 'INSERT' and new.content - editable <> '{}'::jsonb) or
       (tg_op = 'UPDATE' and new.content - editable is distinct from old.content - editable)
    then
      raise exception 'protected word content' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    -- Public revisions are millisecond ISO strings. Every write must advance one.
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 millisecond');
  end if;
  return new;
end;
$$;
revoke all on function public.guard_word_content() from public, anon, authenticated, service_role;
create trigger words_guard_content
  before insert or update on public.words
  for each row execute function public.guard_word_content();

create or replace function public.import_words(p_words jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare item jsonb; added integer := 0; total integer; affected integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_words) is distinct from 'array' or jsonb_array_length(p_words) > 500 then
    raise exception 'invalid import' using errcode = '22023';
  end if;
  total := jsonb_array_length(p_words);
  for item in select value from jsonb_array_elements(p_words) loop
    insert into public.words(user_id, word, content)
      values (auth.uid(), item->>'word', item - 'score' - 'id' - 'user_id')
      on conflict do nothing;
    get diagnostics affected = row_count;
    added := added + affected;
  end loop;
  return jsonb_build_object('added', added, 'duplicates', total - added);
end;
$$;

grant usage on schema public to atlas_assessment_api;
grant usage, create on schema public to atlas_learning_mutator;
grant select on public.words, public.profiles, public.learning_sessions,
  public.learning_results, public.daily_word_completions to atlas_learning_mutator;
grant update(score) on public.words to atlas_learning_mutator;
grant insert(user_id, daily_goal), update(daily_goal) on public.profiles to atlas_learning_mutator;
grant insert(id, user_id, snapshot, assessment_protocol),
  update(snapshot, revision, completed_at, updated_at)
  on public.learning_sessions to atlas_learning_mutator;
grant insert on public.learning_results, public.daily_word_completions,
  public.completed_goal_days to atlas_learning_mutator;

create policy atlas_mutator_words on public.words to atlas_learning_mutator
  using (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid)
  with check (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid);
create policy atlas_mutator_profiles on public.profiles to atlas_learning_mutator
  using (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid)
  with check (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid);
create policy atlas_mutator_sessions on public.learning_sessions to atlas_learning_mutator
  using (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid)
  with check (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid);
create policy atlas_mutator_results on public.learning_results to atlas_learning_mutator
  using (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid)
  with check (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid);
create policy atlas_mutator_progress on public.daily_word_completions to atlas_learning_mutator
  using (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid)
  with check (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid);
create policy atlas_mutator_goals on public.completed_goal_days for insert to atlas_learning_mutator
  with check (user_id = nullif(current_setting('atlas.learning_user', true), '')::uuid);

create function public.atlas_store_learning_session(
  p_user uuid, p_id uuid, p_snapshot jsonb, p_revision integer, p_ranked boolean
) returns integer
language plpgsql security definer set search_path = '' as $$
declare next_revision integer;
begin
  if p_user is null or p_ranked is null or
     p_snapshot->>'id' is distinct from p_id::text or
     p_snapshot->'tutorial' is distinct from 'false'::jsonb or
     (p_ranked and (p_snapshot->'version' is distinct from '3'::jsonb or
                    jsonb_typeof(p_snapshot->'assessmentActions') is distinct from 'array'))
  then
    raise exception 'invalid session' using errcode = '22023';
  end if;
  perform set_config('atlas.learning_user', p_user::text, true);
  if p_revision = 0 then
    insert into public.learning_sessions(id, user_id, snapshot, assessment_protocol)
      values (p_id, p_user, p_snapshot, case when p_ranked then 1 else null end)
      on conflict do nothing returning revision into next_revision;
  else
    update public.learning_sessions set snapshot = p_snapshot, revision = revision + 1, updated_at = now()
      where id = p_id and user_id = p_user and revision = p_revision and completed_at is null
        and (assessment_protocol is not null) = p_ranked
        and snapshot->>'discarded' is distinct from 'true'
      returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'session conflict' using errcode = '40001'; end if;
  return next_revision;
end;
$$;

create function public.atlas_finish_learning_session(p_user uuid, p_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  task public.learning_sessions;
  accepted jsonb := '[]'::jsonb;
  today date := (now() at time zone 'Europe/Istanbul')::date;
  goal integer;
  rated record;
  grade integer;
  practice boolean;
begin
  if p_user is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  perform set_config('atlas.learning_user', p_user::text, true);
  -- Serialize the daily goal count across different sessions for the same owner.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select * into task from public.learning_sessions where id = p_id and user_id = p_user for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if task.completed_at is not null then
    if p_revision is distinct from task.revision - 1 and p_revision is distinct from task.revision then
      raise exception 'session conflict' using errcode = '40001';
    end if;
    select scores into accepted from public.learning_results where session_id = p_id and user_id = p_user;
    return jsonb_build_object('scores', coalesce(accepted, '[]'::jsonb), 'practiceOnly', not found);
  end if;
  if p_revision is distinct from task.revision then
    raise exception 'session conflict' using errcode = '40001';
  end if;
  if task.snapshot->>'phase' is distinct from 'complete' or
     task.snapshot->'queue' is distinct from '[]'::jsonb or
     task.snapshot->'tutorial' is distinct from 'false'::jsonb or
     task.snapshot->>'discarded' = 'true'
  then
    raise exception 'unfinished assessment' using errcode = '22023';
  end if;

  practice := task.assessment_protocol is null;
  if not practice then
    for rated in
      select w.id, w.word, task.snapshot->'assessment'->(x.id::text) as mark
      from jsonb_to_recordset(task.snapshot->'words') as x(id uuid, word text)
      join public.words w on w.id = x.id and w.user_id = p_user and w.word = x.word
      order by w.id
      for update of w
    loop
      if rated.mark->'matchingDone' is distinct from 'true'::jsonb or
         jsonb_typeof(rated.mark->'matchingErrors') is distinct from 'number' or
         jsonb_typeof(rated.mark #> '{meaning,correct}') is distinct from 'boolean' or
         jsonb_typeof(rated.mark #> '{context,correct}') is distinct from 'boolean' or
         (rated.mark #>> '{meaning,correct}' = 'true' and
          coalesce(rated.mark #>> '{meaning,confidence}', '') not in ('20', '0', '-10')) or
         (rated.mark #>> '{context,correct}' = 'true' and
          coalesce(rated.mark #>> '{context,confidence}', '') not in ('20', '0', '-10'))
      then
        raise exception 'incomplete assessment' using errcode = '22023';
      end if;
      grade := round(
        greatest(0, 20 - (rated.mark->>'matchingErrors')::numeric * 10)
        + case when rated.mark #>> '{meaning,correct}' = 'true' then
            case rated.mark #>> '{meaning,confidence}' when '20' then 30 when '0' then 25.5 else 18 end
          else 0 end
        + case when rated.mark #>> '{context,correct}' = 'true' then
            case rated.mark #>> '{context,confidence}' when '20' then 50 when '0' then 42.5 else 30 end
          else 0 end
      );
      update public.words set score = grade where id = rated.id and user_id = p_user;
      accepted := accepted || jsonb_build_array(jsonb_build_object('id', rated.id, 'score', grade));
    end loop;

    insert into public.learning_results(session_id, user_id, scores) values (p_id, p_user, accepted);
    insert into public.daily_word_completions(user_id, day, word_id)
      select p_user, today, x.id from jsonb_to_recordset(accepted) as x(id uuid)
      on conflict do nothing;
    select daily_goal into goal from public.profiles where user_id = p_user;
    goal := coalesce(goal, 20);
    if (select count(*) from public.daily_word_completions where user_id = p_user and day = today) >= goal then
      insert into public.completed_goal_days(user_id, day, goal)
        values (p_user, today, goal) on conflict do nothing;
    end if;
  end if;

  update public.learning_sessions
    set completed_at = now(), revision = revision + 1, updated_at = now(),
        snapshot = jsonb_set(snapshot, '{saved}', 'true')
    where id = p_id and user_id = p_user;
  return jsonb_build_object('scores', accepted, 'practiceOnly', practice);
end;
$$;

create or replace function public.set_daily_goal(p_goal integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  -- Same subject claims as auth.uid(). The function owner has no auth schema privileges.
  owner_id uuid := coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub'
  )::uuid;
  today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if owner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_goal is null or p_goal not between 10 and 100 or p_goal % 10 <> 0 then
    raise exception 'invalid goal' using errcode = '22023';
  end if;
  perform set_config('atlas.learning_user', owner_id::text, true);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  insert into public.profiles(user_id, daily_goal) values(owner_id, p_goal)
    on conflict(user_id) do update set daily_goal = excluded.daily_goal;
  if (select count(*) from public.daily_word_completions where user_id = owner_id and day = today) >= p_goal then
    insert into public.completed_goal_days(user_id, day, goal)
      values(owner_id, today, p_goal) on conflict do nothing;
  end if;
  return p_goal;
end;
$$;

revoke all on function public.atlas_store_learning_session(uuid,uuid,jsonb,integer,boolean),
  public.atlas_finish_learning_session(uuid,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.atlas_store_learning_session(uuid,uuid,jsonb,integer,boolean),
  public.atlas_finish_learning_session(uuid,uuid,integer) to atlas_assessment_api;
revoke all on function public.set_daily_goal(integer) from public, anon, service_role;
grant execute on function public.set_daily_goal(integer) to authenticated;
alter function public.atlas_store_learning_session(uuid,uuid,jsonb,integer,boolean) owner to atlas_learning_mutator;
alter function public.atlas_finish_learning_session(uuid,uuid,integer) owner to atlas_learning_mutator;
alter function public.set_daily_goal(integer) owner to atlas_learning_mutator;
revoke create on schema public from atlas_learning_mutator;
grant atlas_learning_mutator to postgres with inherit false, set false;

do $$
begin
  if not has_function_privilege('atlas_assessment_api', 'public.atlas_finish_learning_session(uuid,uuid,integer)', 'execute') or
     not has_function_privilege('atlas_assessment_api', 'public.atlas_store_learning_session(uuid,uuid,jsonb,integer,boolean)', 'execute') or
     has_function_privilege('authenticated', 'public.atlas_finish_learning_session(uuid,uuid,integer)', 'execute') or
     has_function_privilege('anon', 'public.atlas_store_learning_session(uuid,uuid,jsonb,integer,boolean)', 'execute')
  then
    raise exception 'assessment execution grants do not match the required isolation';
  end if;
end;
$$;
notify pgrst, 'reload schema';
