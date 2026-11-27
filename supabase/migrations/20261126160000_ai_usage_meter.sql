begin;
set local lock_timeout = '5s';

-- Older backends can keep using the service-only RPC while new clients record attempts.
-- The historical UTC day bucket also represents its first minute and must be written once.
create or replace function public.consume_ai_quota(p_user_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  day_bucket timestamptz := date_trunc('day', now(), 'UTC');
  minute_bucket timestamptz := date_trunc('minute', now());
begin
  insert into public.ai_usage as usage(user_id, bucket, requests)
  select p_user_id, bucket, 1 from
    (select distinct unnest(array[day_bucket, minute_bucket]) as bucket) as buckets
  order by bucket
  on conflict (user_id, bucket) do update set requests = usage.requests + 1;
  return true;
end $$;
revoke all on function public.consume_ai_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid) to service_role;
commit;
