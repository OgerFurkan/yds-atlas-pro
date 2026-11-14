-- STAGING ONLY: reviewed paired migration; never apply insecure draft in isolation.
-- DRAFT FOR REVIEW. NOT applied automatically or included in migration history.
-- Generate an official migration using: bunx supabase migration new atlas_learning_foundation
-- Then copy this SQL into the created file after testing against a development database.

create table public.daily_plan_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_plan_states enable row level security;
create policy daily_plan_owner_select on public.daily_plan_states for select to authenticated
  using ((select auth.uid()) = user_id);
create policy daily_plan_owner_insert on public.daily_plan_states for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy daily_plan_owner_update on public.daily_plan_states for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.daily_plan_states from public, anon, authenticated;
grant select, insert, update on public.daily_plan_states to authenticated;

-- Make account ownership part of the foreign key, not only the review RLS policy.
alter table public.words add constraint words_user_id_id_unique unique (user_id, id);
create table public.word_review_schedules (
  user_id uuid not null references auth.users(id) on delete cascade,
  word_id uuid not null,
  repetitions integer not null default 0 check (repetitions >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  interval_days integer not null default 0 check (interval_days between 0 and 36500),
  ease_factor numeric(4,2) not null default 2.5 check (ease_factor between 1.3 and 2.8),
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  primary key (user_id, word_id),
  foreign key (user_id, word_id) references public.words (user_id, id) on delete cascade
);
create index word_review_schedules_due on public.word_review_schedules(user_id, due_at);
alter table public.word_review_schedules enable row level security;
create policy word_review_owner on public.word_review_schedules for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.word_review_schedules from public, anon, authenticated;
grant select, insert, update, delete on public.word_review_schedules to authenticated;

-- Harden privileges in the SAME migration, prior to any external access.
-- PHASE 3B v1.4 SECURITY CANDIDATE, NOT AN OFFICIAL MIGRATION.
-- For isolated PGlite tests ONLY, execute after learning_foundation_draft.sql.
-- IMPORTANT: This intentionally disables client-side DML for daily plans and SRS.
-- Do not apply to staging/production until the backend writer is switched to a
-- verified, server-only service-role client with revision-safe CAS updates.

-- Restrict the Data API surface; RLS remains enabled for owner-only reads.
revoke insert, update, delete on public.daily_plan_states from public, anon, authenticated;
revoke insert, update, delete on public.word_review_schedules from public, anon, authenticated;
drop policy if exists daily_plan_owner_insert on public.daily_plan_states;
drop policy if exists daily_plan_owner_update on public.daily_plan_states;
drop policy if exists word_review_owner on public.word_review_schedules;
create policy word_review_owner_select on public.word_review_schedules
  for select to authenticated using ((select auth.uid()) = user_id);

-- Explicit server-only privileges (the server's secret key MUST NEVER enter the browser).
grant select on public.words to service_role;
grant select, insert, update, delete on public.daily_plan_states to service_role;
grant select, insert, update, delete on public.word_review_schedules to service_role;

-- Defense in depth: validate plan structure, ownership and monotonically
-- increasing revision EVEN IF the trusted server makes a mistake.
create function public.validate_daily_plan_state_v14()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_group jsonb;
  v_raw_word jsonb;
  v_word_id uuid;
  v_day integer;
  v_days integer[] := array[]::integer[];
  v_ids uuid[] := array[]::uuid[];
begin
  if TG_OP = 'INSERT' then
    if NEW.revision <> 1 then
      raise exception 'new daily plan must start at revision 1' using errcode = '23514';
    end if;
  else
    if NEW.user_id is distinct from OLD.user_id then
      raise exception 'daily plan owner cannot change' using errcode = '23514';
    end if;
    if NEW.revision <> OLD.revision + 1 then
      raise exception 'daily plan revision must increase by exactly one' using errcode = '23514';
    end if;
  end if;

  if jsonb_typeof(NEW.payload) is distinct from 'object'
     or jsonb_typeof(NEW.payload->'groupSize') is distinct from 'number'
     or (NEW.payload->>'groupSize') not in ('10','20','30','40')
     or jsonb_typeof(NEW.payload->'assignments') is distinct from 'array'
     or jsonb_typeof(NEW.payload->'excludedWordIds') is distinct from 'array'
  then
    raise exception 'invalid daily plan shape' using errcode = '23514';
  end if;
  if jsonb_array_length(NEW.payload->'assignments') > 60
     or jsonb_array_length(NEW.payload->'excludedWordIds') > 2400 then
    raise exception 'daily plan exceeds limits' using errcode = '23514';
  end if;

  for v_group in select value from jsonb_array_elements(NEW.payload->'assignments') loop
    if jsonb_typeof(v_group) is distinct from 'object'
       or jsonb_typeof(v_group->'day') is distinct from 'number'
       or jsonb_typeof(v_group->'words') is distinct from 'array' then
      raise exception 'invalid daily plan group' using errcode = '23514';
    end if;
    v_day := (v_group->>'day')::integer;
    if v_day < 1 or v_day > 60 or v_day = any(v_days) then
      raise exception 'duplicate or out-of-range daily plan day' using errcode = '23514';
    end if;
    v_days := array_append(v_days, v_day);
    if jsonb_array_length(v_group->'words') > 40 then
      raise exception 'daily plan group exceeds 40 words' using errcode = '23514';
    end if;
    for v_raw_word in select value from jsonb_array_elements(v_group->'words') loop
      if jsonb_typeof(v_raw_word) is distinct from 'string' then
        raise exception 'invalid daily plan word ID' using errcode = '23514';
      end if;
      v_word_id := (v_raw_word #>> '{}')::uuid;
      if v_word_id = any(v_ids) then
        raise exception 'duplicate daily plan word' using errcode = '23514';
      end if;
      if not exists (
        select 1 from public.words w where w.id = v_word_id and w.user_id = NEW.user_id
      ) then
        raise exception 'daily plan word does not belong to owner' using errcode = '23503';
      end if;
      v_ids := array_append(v_ids, v_word_id);
    end loop;
  end loop;

  for v_raw_word in select value from jsonb_array_elements(NEW.payload->'excludedWordIds') loop
    if jsonb_typeof(v_raw_word) is distinct from 'string' then
      raise exception 'invalid excluded word ID' using errcode = '23514';
    end if;
    v_word_id := (v_raw_word #>> '{}')::uuid;
    if v_word_id = any(v_ids) then
      raise exception 'duplicate or assigned excluded word' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.words w where w.id = v_word_id and w.user_id = NEW.user_id
    ) then
      raise exception 'excluded word does not belong to owner' using errcode = '23503';
    end if;
    v_ids := array_append(v_ids, v_word_id);
  end loop;
  return NEW;
end;
$$;
revoke all on function public.validate_daily_plan_state_v14() from public, anon, authenticated;
drop trigger if exists daily_plan_validate_v14 on public.daily_plan_states;
create trigger daily_plan_validate_v14
  before insert or update on public.daily_plan_states
  for each row execute function public.validate_daily_plan_state_v14();
