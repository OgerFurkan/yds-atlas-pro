begin;
set local lock_timeout='5s';

-- Private rows never enter the Data API, account export, or learner-readable session history.
create table atlas_account.online_assessments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null default 1 check(revision > 0),
  state jsonb not null,
  start_command uuid not null,
  start_request jsonb not null,
  last_command uuid,
  last_request jsonb,
  status text not null check(status in ('active','cancelled','expired','complete')),
  expires_at timestamptz not null,
  unique(user_id,start_command)
);
create unique index online_assessment_one_active on atlas_account.online_assessments(user_id) where status='active';
alter table atlas_account.online_assessments enable row level security;
revoke all on atlas_account.online_assessments from public, anon, authenticated, service_role;
grant usage on schema atlas_account to atlas_assessment_api, atlas_learning_mutator;
grant select,insert,update on atlas_account.online_assessments to atlas_assessment_api;
create policy server_assessments on atlas_account.online_assessments to atlas_assessment_api using(true) with check(true);
grant select(id,user_id,status,expires_at) on atlas_account.online_assessments to atlas_learning_mutator, atlas_session_reader;
grant usage on schema atlas_account to atlas_session_reader;
create policy live_assessment_reader on atlas_account.online_assessments for select to atlas_session_reader
  using(user_id=(select auth.uid()));
create policy score_assessment_reader on atlas_account.online_assessments for select to atlas_learning_mutator
  using(user_id=nullif(current_setting('atlas.learning_user',true),'')::uuid);
create function public.atlas_online_assessment_active() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select from atlas_account.online_assessments where user_id=auth.uid() and status='active' and expires_at>statement_timestamp())
$$;
grant create on schema public to atlas_session_reader;
alter function public.atlas_online_assessment_active() owner to atlas_session_reader;
revoke create on schema public from atlas_session_reader;
revoke all on function public.atlas_online_assessment_active() from public,anon,service_role;
grant execute on function public.atlas_online_assessment_active() to authenticated;

-- Legacy writers can resume their own snapshots but only a private, finished run can mint a score.
alter function public.atlas_finish_learning_session(uuid,uuid,integer) rename to atlas_finish_verified_session;
revoke execute on function public.atlas_finish_verified_session(uuid,uuid,integer) from atlas_assessment_api;
grant update(assessment_protocol) on public.learning_sessions to atlas_learning_mutator;
create function public.atlas_finish_learning_session(p_user uuid,p_id uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform set_config('atlas.learning_user',p_user::text,true);
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if not exists(select from atlas_account.online_assessments
      where id=p_id and user_id=p_user and status='complete') then
    update public.learning_sessions set assessment_protocol=null
     where user_id=p_user and id=p_id and completed_at is null and assessment_protocol=1;
  end if;
  return public.atlas_finish_verified_session(p_user,p_id,p_revision);
end $$;
grant create on schema public to atlas_learning_mutator;
alter function public.atlas_finish_learning_session(uuid,uuid,integer) owner to atlas_learning_mutator;
revoke create on schema public from atlas_learning_mutator;
revoke all on function public.atlas_finish_learning_session(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.atlas_finish_learning_session(uuid,uuid,integer) to atlas_assessment_api;
notify pgrst,'reload schema';
commit;
