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
