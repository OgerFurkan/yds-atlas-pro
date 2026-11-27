begin;
set local lock_timeout = '5s';

alter table atlas_account.online_assessments
  add column word_versions jsonb;

-- Check the version while acquiring the same row lock used for the score write.
create or replace function public.atlas_finish_verified_session(p_user uuid, p_id uuid, p_revision integer)
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
      from jsonb_to_recordset(task.snapshot->'words') as x(id uuid, word text, "updatedAt" timestamptz)
      join public.words w on w.id = x.id and w.user_id = p_user and w.word = x.word
        and case
          when task.snapshot->'assessmentVersions' ? x.id::text
            then w.updated_at = (task.snapshot->'assessmentVersions'->>x.id::text)::timestamptz
          when x."updatedAt" is not null then date_trunc('milliseconds', w.updated_at) = x."updatedAt"
          else false
        end
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

commit;
