-- Gemini 3.5 Flash-Lite serves word completion with a 15 RPM free-tier limit, so the
-- per-user minute cap follows the provider instead of throttling below it.
create or replace function public.consume_ai_quota(p_user_id uuid) returns boolean
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
    if amount >= 15 then return false; end if;
    update public.ai_usage set requests=requests+1 where user_id=p_user_id and bucket=minute_bucket;
  elsif amount >= 15 then return false;
  end if;
  update public.ai_usage set requests=requests+1 where user_id=p_user_id and bucket=day_bucket;
  return true;
end; $$;
