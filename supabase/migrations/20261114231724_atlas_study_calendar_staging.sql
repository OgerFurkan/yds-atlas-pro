-- Additive migration. First apply ONLY to the isolated YDS Atlas staging project.
-- User-created calendar events are NOT verified learning results.
-- All existing accounts, word scores, learning history and plans remain unchanged.
create table if not exists public.study_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('review','vocabulary','reading','translation','exam','custom')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  notes text not null default '' check (char_length(notes) <= 1500),
  minutes smallint not null check (minutes between 5 and 240),
  status text not null default 'planned' check (status in ('planned','done','skipped')),
  origin text not null default 'manual' check (origin in ('manual','coach')),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists study_calendar_owner_day_idx
  on public.study_calendar_entries (user_id, day);
alter table public.study_calendar_entries enable row level security;
revoke all on table public.study_calendar_entries from anon, authenticated;
grant select, insert, update, delete on table public.study_calendar_entries to authenticated;
-- Policies are idempotent so a previously tested staging migration can be replayed
-- by a later repository migration without granting any broader permissions.
do $calendar_policies$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_calendar_entries' and policyname='calendar_owner_select') then
    create policy calendar_owner_select on public.study_calendar_entries for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_calendar_entries' and policyname='calendar_owner_insert') then
    create policy calendar_owner_insert on public.study_calendar_entries for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_calendar_entries' and policyname='calendar_owner_update') then
    create policy calendar_owner_update on public.study_calendar_entries for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_calendar_entries' and policyname='calendar_owner_delete') then
    create policy calendar_owner_delete on public.study_calendar_entries for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end;
$calendar_policies$;
