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
