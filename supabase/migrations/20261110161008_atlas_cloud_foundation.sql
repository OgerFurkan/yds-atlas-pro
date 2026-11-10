-- User ownership is enforced by Postgres even when callers bypass the Bun API.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_goal integer not null default 20 check (daily_goal between 10 and 100 and daily_goal % 10 = 0),
  created_at timestamptz not null default now()
);
create table public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null check (length(btrim(word)) between 1 and 120),
  score integer not null default 0 check (score between 0 and 100),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index words_owner_headword on public.words (user_id, lower(regexp_replace(btrim(word), '\s+', ' ', 'g')));
create index words_owner_updated on public.words (user_id, updated_at desc, id);
create table public.learning_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  revision integer not null default 1 check (revision > 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create index sessions_owner_updated on public.learning_sessions (user_id, updated_at desc);
create table public.learning_results (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scores jsonb not null check (jsonb_typeof(scores) = 'array'),
  completed_at timestamptz not null default now(),
  foreign key (user_id, session_id) references public.learning_sessions(user_id, id) on delete cascade
);
create index results_owner on public.learning_results (user_id);
-- Deliberately retain historical completion IDs when a library word is removed.
create table public.daily_word_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  word_id uuid not null,
  primary key (user_id, day, word_id)
);
create table public.completed_goal_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  goal integer not null check (goal between 10 and 100),
  primary key (user_id, day)
);
create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket timestamptz not null,
  requests integer not null default 0 check (requests >= 0),
  primary key (user_id, bucket)
);

alter table public.profiles enable row level security;
alter table public.words enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.learning_results enable row level security;
alter table public.daily_word_completions enable row level security;
alter table public.completed_goal_days enable row level security;
alter table public.ai_usage enable row level security;

create policy profiles_owner on public.profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy words_owner on public.words for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sessions_read on public.learning_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy sessions_insert on public.learning_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sessions_update on public.learning_sessions for update to authenticated
  using ((select auth.uid()) = user_id and completed_at is null) with check ((select auth.uid()) = user_id);
create policy results_read on public.learning_results for select to authenticated using ((select auth.uid()) = user_id);
create policy results_insert on public.learning_results for insert to authenticated with check ((select auth.uid()) = user_id);
create policy completions_owner on public.daily_word_completions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy goals_owner on public.completed_goal_days for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.profiles, public.words, public.learning_sessions, public.learning_results,
  public.daily_word_completions, public.completed_goal_days, public.ai_usage from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.words to authenticated;
grant select, insert, update on public.learning_sessions to authenticated;
grant select, insert on public.learning_results to authenticated;
grant select, insert on public.daily_word_completions, public.completed_goal_days to authenticated;
grant select, insert, update on public.ai_usage to service_role;

create function public.import_words(p_words jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare item jsonb; added integer := 0; total integer; affected integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_words) <> 'array' or jsonb_array_length(p_words) > 500 then raise exception 'invalid import'; end if;
  total := jsonb_array_length(p_words);
  for item in select value from jsonb_array_elements(p_words) loop
    insert into public.words(user_id, word, score, content)
      values (auth.uid(), item->>'word', coalesce((item->>'score')::integer, 0), item - 'id' - 'user_id')
      on conflict do nothing;
    get diagnostics affected = row_count;
    added := added + affected;
  end loop;
  return jsonb_build_object('added', added, 'duplicates', total - added);
end; $$;
revoke all on function public.import_words(jsonb) from public, anon;
grant execute on function public.import_words(jsonb) to authenticated;

create function public.save_learning_session(p_id uuid, p_snapshot jsonb, p_expected_revision integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare next_revision integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_snapshot->>'id' is distinct from p_id::text or coalesce((p_snapshot->>'tutorial')::boolean, true)
    then raise exception 'invalid snapshot'; end if;
  if p_expected_revision = 0 then
    insert into public.learning_sessions(id, user_id, snapshot)
      values (p_id, auth.uid(), p_snapshot) on conflict do nothing returning revision into next_revision;
  else
    update public.learning_sessions set snapshot = p_snapshot, revision = revision + 1, updated_at = now()
      where id = p_id and user_id = auth.uid() and revision = p_expected_revision and completed_at is null
      returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'session conflict' using errcode = '40001'; end if;
  return next_revision;
end; $$;
revoke all on function public.save_learning_session(uuid,jsonb,integer) from public, anon;
grant execute on function public.save_learning_session(uuid,jsonb,integer) to authenticated;

create function public.complete_learning_session(p_id uuid, p_scores jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare existing jsonb; task public.learning_sessions; today date; goal integer; accepted jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select scores into existing from public.learning_results where session_id = p_id and user_id = auth.uid();
  if found then return existing; end if;
  select * into task from public.learning_sessions where id = p_id and user_id = auth.uid() for update;
  if not found then
    select scores into existing from public.learning_results where session_id = p_id and user_id = auth.uid();
    if found then return existing; end if;
    raise exception 'session not found' using errcode = '42501';
  end if;
  select scores into existing from public.learning_results where session_id = p_id;
  if found then return existing; end if;
  if task.snapshot->>'phase' <> 'complete' then raise exception 'unfinished session'; end if;
  if jsonb_typeof(p_scores) <> 'array' or jsonb_array_length(p_scores) > 100 then raise exception 'invalid scores'; end if;
  if exists (select 1 from jsonb_to_recordset(p_scores) as x(id uuid, score integer) where score is null or score not between 0 and 100)
    then raise exception 'invalid score'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'score', x.score)), '[]'::jsonb) into accepted
    from jsonb_to_recordset(p_scores) as x(id uuid, score integer) join public.words w on w.id = x.id and w.user_id = auth.uid();
  update public.words w set score = x.score, updated_at = now()
    from jsonb_to_recordset(accepted) as x(id uuid, score integer) where w.id = x.id and w.user_id = auth.uid();
  insert into public.learning_results(session_id, user_id, scores) values (p_id, auth.uid(), accepted);
  today := (now() at time zone 'Europe/Istanbul')::date;
  insert into public.daily_word_completions(user_id, day, word_id)
    select auth.uid(), today, x.id from jsonb_to_recordset(accepted) as x(id uuid, score integer) on conflict do nothing;
  select daily_goal into goal from public.profiles where user_id = auth.uid();
  goal := coalesce(goal, 20);
  if (select count(*) from public.daily_word_completions where user_id = auth.uid() and day = today) >= goal then
    insert into public.completed_goal_days(user_id, day, goal) values (auth.uid(), today, goal) on conflict do nothing;
  end if;
  update public.learning_sessions set completed_at = now(), revision = revision + 1,
    snapshot = jsonb_set(snapshot, '{saved}', 'true'::jsonb), updated_at = now()
    where id = p_id and user_id = auth.uid();
  return accepted;
end; $$;
revoke all on function public.complete_learning_session(uuid,jsonb) from public, anon;
grant execute on function public.complete_learning_session(uuid,jsonb) to authenticated;

-- Only Bun's server client can consume this quota. Ordinary user requests never use its key.
create function public.consume_ai_quota(p_user_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare day_bucket timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  minute_bucket timestamptz := date_trunc('minute', now()); amount integer;
begin
  insert into public.ai_usage(user_id,bucket,requests) values(p_user_id,day_bucket,0) on conflict do nothing;
  select requests into amount from public.ai_usage where user_id=p_user_id and bucket=day_bucket for update;
  if amount >= 40 then return false; end if;
  if minute_bucket <> day_bucket then
    insert into public.ai_usage(user_id,bucket,requests) values(p_user_id,minute_bucket,0) on conflict do nothing;
    select requests into amount from public.ai_usage where user_id=p_user_id and bucket=minute_bucket for update;
    if amount >= 5 then return false; end if;
    update public.ai_usage set requests=requests+1 where user_id=p_user_id and bucket=minute_bucket;
  elsif amount >= 5 then return false;
  end if;
  update public.ai_usage set requests=requests+1 where user_id=p_user_id and bucket=day_bucket;
  return true;
end; $$;
revoke all on function public.consume_ai_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid) to service_role;


create function public.apply_word_scores(p_scores jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_scores) <> 'array' or jsonb_array_length(p_scores) > 500 then raise exception 'invalid scores'; end if;
  if exists(select 1 from jsonb_to_recordset(p_scores) as x(id uuid,score integer) where id is null or score is null or score not between 0 and 100) then raise exception 'invalid score'; end if;
  if (select count(distinct x.id) from jsonb_to_recordset(p_scores) as x(id uuid)) <> jsonb_array_length(p_scores) then raise exception 'duplicate ids'; end if;
  update public.words w set score=x.score,updated_at=now() from jsonb_to_recordset(p_scores) as x(id uuid,score integer) where w.id=x.id and w.user_id=auth.uid();
end; $$;
revoke all on function public.apply_word_scores(jsonb) from public, anon;
grant execute on function public.apply_word_scores(jsonb) to authenticated;


grant usage on schema public to authenticated, service_role;
create function public.set_daily_goal(p_goal integer) returns integer
language plpgsql security invoker set search_path = '' as $$
declare today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_goal not between 10 and 100 or p_goal % 10 <> 0 then raise exception 'invalid goal'; end if;
  insert into public.profiles(user_id,daily_goal) values(auth.uid(),p_goal)
    on conflict(user_id) do update set daily_goal=excluded.daily_goal;
  if (select count(*) from public.daily_word_completions where user_id=auth.uid() and day=today)>=p_goal then
    insert into public.completed_goal_days(user_id,day,goal) values(auth.uid(),today,p_goal) on conflict do nothing;
  end if;
  return p_goal;
end; $$;
revoke all on function public.set_daily_goal(integer) from public, anon;
grant execute on function public.set_daily_goal(integer) to authenticated;

