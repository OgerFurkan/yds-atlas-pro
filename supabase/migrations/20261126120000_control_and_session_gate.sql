begin;
set local lock_timeout='5s';

-- PostgREST runs this hook after switching to the request role. Operations must verify
-- the effective hook configuration before exposing any restored or upgraded instance.
create function public.atlas_request_session_gate() returns void
language plpgsql stable security invoker set search_path='' as $$
begin
  if current_user='authenticated' then
    if not public.atlas_live_session() then
      raise sqlstate 'PT401' using message='Session has ended';
    end if;
  end if;
end $$;
revoke all on function public.atlas_request_session_gate() from public;
grant execute on function public.atlas_request_session_gate() to anon,authenticated,service_role;
do $$
begin
  if exists(select 1 from pg_catalog.pg_db_role_setting s,
    lateral unnest(s.setconfig) c where s.setrole in (0,'authenticator'::regrole)
    and split_part(c,'=',1)='pgrst.db_pre_request' and split_part(c,'=',2) not in ('','public.atlas_request_session_gate')) then
    raise exception 'Existing PostgREST request hook requires reviewed composition';
  end if;
end $$;
alter role authenticator set pgrst.db_pre_request='public.atlas_request_session_gate';

create function public.atlas_control_mfa() returns boolean language sql stable security invoker set search_path='' as $$
  select public.atlas_live_session() and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2',false)
$$;
revoke all on function public.atlas_control_mfa() from public,anon,service_role;
grant execute on function public.atlas_control_mfa() to authenticated;

-- Private receipts contain no JWTs. Each command and all associated immutable revisions commit together.
create table atlas_account.editorial_receipts (
  operation uuid primary key, actor uuid not null, command_hash text not null,
  result jsonb not null, created_at timestamptz not null default now()
);
revoke all on atlas_account.editorial_receipts from public,anon,authenticated;
grant usage on schema atlas_account to service_role;
grant select,insert on atlas_account.editorial_receipts to service_role;

-- Older workers must not publish another gloss after the cutover.
create function atlas_account.reject_tooltip_content() returns trigger language plpgsql set search_path='' as $$
begin
  if new.part_of_speech='Tooltip' or new.content->>'kind'='atlas_tooltip_gloss_v1' then raise check_violation; end if;
  if tg_op='UPDATE' and old.part_of_speech='Tooltip' then raise check_violation; end if;
  return new;
end $$;
revoke all on function atlas_account.reject_tooltip_content() from public,anon,authenticated,service_role;
create trigger atlas_canonical_entries before insert or update on public.atlas_lexicon_entries
for each row execute function atlas_account.reject_tooltip_content();

create function public.atlas_apply_editorial(p_actor uuid,p_operation uuid,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  prior atlas_account.editorial_receipts%rowtype;
  r public.atlas_lexicon_entries%rowtype;
  new_sense text;
  item jsonb; result jsonb:='[]'; op text; c jsonb; src jsonb; st text;
  h text:=encode(sha256(convert_to(p_items::text,'UTF8')),'hex');
begin
  if p_actor is null or p_operation is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 20 then raise invalid_parameter_value; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
  select * into prior from atlas_account.editorial_receipts where operation=p_operation;
  if found then
    if prior.actor<>p_actor or prior.command_hash<>h then raise serialization_failure; end if;
    return prior.result;
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    new_sense:=item->>'senseKey'; op:=item->>'action'; c:=item->'content'; src:=item->'provenance'; st:='human_reviewed';
    if op not in ('publish','restore','quarantine') or op is null then raise invalid_parameter_value; end if;
    if item ? 'legacy' then
      if op<>'publish' or not exists (
        select from public.atlas_lexicon_entries old where old.id=(item->'legacy'->>'id')::uuid and
        old.revision=(item->'legacy'->>'revision')::int and old.digest=item->'legacy'->>'digest' and
        old.word_key=item->>'wordKey' and old.part_of_speech='Tooltip' and old.provenance->>'kind'='atlas_tooltip_gloss_v1'
        and old.provenance->>'license'='CC BY-SA 4.0' and src->>'license'=old.provenance->>'license'
        and src->>'source'=old.provenance->>'url' and length(src->>'attribution')>0
      ) then raise invalid_parameter_value; end if;
      src:=src||jsonb_build_object('legacy',item->'legacy');
    end if;
    if item->>'entryId' is null then
      if op<>'publish' or (item->>'revision')::int is distinct from 0 then raise invalid_parameter_value; end if;
      insert into public.atlas_lexicon_entries(word_key,part_of_speech,sense_key,status,content,provenance,digest)
      values(item->>'wordKey',c->>'partOfSpeech',item->>'senseKey',st,c,src,encode(sha256(convert_to(c::text,'UTF8')),'hex')) returning * into r;
    else
      select * into strict r from public.atlas_lexicon_entries where id=(item->>'entryId')::uuid for update;
      if r.part_of_speech='Tooltip' then raise invalid_parameter_value; end if;
      if r.revision is distinct from (item->>'revision')::int then raise serialization_failure; end if;
      if op='quarantine' then new_sense:=r.sense_key; st:='quarantined'; c:=r.content; src:=r.provenance;
      elsif op='restore' then
        select content,provenance into strict c,src from public.atlas_lexicon_entry_revisions
          where entry_id=r.id and revision=(item->>'target')::int and status='human_reviewed';
      elsif item->>'wordKey' is distinct from r.word_key then
        raise invalid_parameter_value;
      end if;
      if op='publish' and r.provenance->>'license'='CC BY-SA 4.0' and
        (src->>'license' is distinct from 'CC BY-SA 4.0' or src->>'source' is distinct from coalesce(r.provenance->>'source',r.provenance->>'url')) then
        raise invalid_parameter_value;
      end if;
      if r.provenance ? 'legacy' and op='publish' then
        if src->>'license' is distinct from r.provenance->>'license' or src->>'source' is distinct from r.provenance->>'source'
          or (src ? 'legacy' and src->'legacy' is distinct from r.provenance->'legacy') then raise invalid_parameter_value; end if;
        src:=src||jsonb_build_object('legacy',r.provenance->'legacy');
      end if;
      update public.atlas_lexicon_entries set sense_key=new_sense,part_of_speech=c->>'partOfSpeech',revision=revision+1, status=st,content=c,provenance=src,
        digest=encode(sha256(convert_to(c::text,'UTF8')),'hex'),updated_at=clock_timestamp() where id=r.id returning * into r;
    end if;
    insert into public.atlas_lexicon_entry_revisions(entry_id,revision,status,action,actor_id,reason_code,digest,content,provenance)
    values(r.id,r.revision,r.status,case when op='quarantine' then 'quarantined' else 'editorial_approved' end,p_actor,left(coalesce(item->>'reason',op),64),r.digest,r.content,r.provenance);
    result:=result||jsonb_build_array(jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status));
  end loop;
  insert into atlas_account.editorial_receipts(operation,actor,command_hash,result) values(p_operation,p_actor,h,result);
  return result;
end $$;
revoke all on function public.atlas_apply_editorial(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.atlas_apply_editorial(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
