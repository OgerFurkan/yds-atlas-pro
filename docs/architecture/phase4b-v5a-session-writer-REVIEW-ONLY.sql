-- PHASE 4B v5A: REVIEW-ONLY, NOT AN APPLIED MIGRATION.
-- This function alone is additive and does NOT revoke the legacy client save path.
-- A coordinated backend cutover plus separate privilege revocations are mandatory.
-- Never expose the service_role secret in a browser or mobile client.

create or replace function public.save_learning_session_v5(
  p_owner_id uuid, p_id uuid, p_snapshot jsonb, p_expected_revision integer
) returns integer
language plpgsql
security invoker
set search_path = ''
as $v5_save$
declare
  v_revision integer;
begin
  if p_owner_id is null or p_id is null or
     p_expected_revision is null or p_expected_revision < 0 or
     jsonb_typeof(p_snapshot) is distinct from 'object' or
     p_snapshot->>'id' is distinct from p_id::text or
     p_snapshot->>'tutorial' is distinct from 'false' then
    raise exception 'invalid owner, session or snapshot' using errcode = '22023';
  end if;

  -- The Bun API MUST authenticate and schema-validate the game before calling
  -- this service-only function. A privileged service_role caller is trusted
  -- to pass the authenticated ctx.userId (never a browser-supplied owner).
  if p_expected_revision = 0 then
    insert into public.learning_sessions(id, user_id, snapshot)
      values(p_id, p_owner_id, p_snapshot)
      on conflict do nothing
      returning revision into v_revision;
  else
    update public.learning_sessions
       set snapshot = p_snapshot, revision = revision + 1, updated_at = now()
     where id = p_id and user_id = p_owner_id
       and revision = p_expected_revision and completed_at is null
     returning revision into v_revision;
  end if;

  if v_revision is null then
    raise exception 'session revision conflict' using errcode = '40001';
  end if;
  return v_revision;
end;
$v5_save$;

-- Explicitly prevent default PUBLIC EXECUTE on new public functions.
revoke all on function public.save_learning_session_v5(uuid,uuid,jsonb,integer)
  from PUBLIC, anon, authenticated;
grant execute on function public.save_learning_session_v5(uuid,uuid,jsonb,integer)
  to service_role;
