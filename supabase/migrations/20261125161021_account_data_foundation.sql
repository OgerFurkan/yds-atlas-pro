-- Additive, owner-scoped contracts. Historical words start at revision zero.
create schema atlas_account;
revoke all on schema atlas_account from public, anon, authenticated, service_role;
create role atlas_account_mutator nologin noinherit;
grant atlas_account_mutator to postgres with set true;
grant usage on schema auth, public, atlas_account to atlas_account_mutator;
grant usage on schema atlas_account to authenticated;

create table atlas_account.library_versions (
  user_id uuid primary key references auth.users on delete cascade,
  revision bigint not null check (revision > 0)
);
revoke all on atlas_account.library_versions from public,anon,authenticated,service_role;
grant select on atlas_account.library_versions to authenticated;
alter table atlas_account.library_versions enable row level security;
create policy own_version on atlas_account.library_versions for select to authenticated
  using (user_id = (select auth.uid()));

create role atlas_session_reader nologin noinherit;
grant atlas_session_reader to postgres with set true;
grant usage on schema auth, public to atlas_session_reader;
grant select(id,user_id,not_after) on auth.sessions to atlas_session_reader;
create function public.atlas_live_session() returns boolean language sql stable security definer set search_path='' as $$
  select exists (select from auth.sessions s where s.user_id=auth.uid()
    and s.id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid
    and (s.not_after is null or s.not_after>statement_timestamp()))
$$;
-- GoTrue deployments may enable RLS on auth.sessions.
create policy atlas_read_session_identity on auth.sessions for select to atlas_session_reader
  using(user_id=(select auth.uid()));
grant create on schema public to atlas_session_reader;
alter function public.atlas_live_session() owner to atlas_session_reader;
revoke create on schema public from atlas_session_reader;
revoke all on function public.atlas_live_session() from public,anon,authenticated,service_role;
grant execute on function public.atlas_live_session() to authenticated,atlas_account_mutator,atlas_learning_mutator;

-- Transition tables coalesce bulk writes. During auth.users cascade the parent is already gone.
create function atlas_account.bump_library() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into atlas_account.library_versions as v(user_id,revision)
    select distinct w.user_id,1 from changed w join auth.users u on u.id=w.user_id
    order by w.user_id
    on conflict(user_id) do update set revision=v.revision+1;
  return null;
end;
$$;
revoke all on function atlas_account.bump_library() from public, anon, authenticated, service_role;
create trigger words_version_insert after insert on public.words
  referencing new table as changed for each statement execute function atlas_account.bump_library();
create trigger words_version_delete after delete on public.words
  referencing old table as changed for each statement execute function atlas_account.bump_library();
-- Owner is immutable for every application writer.
create trigger words_version_update after update on public.words
  referencing new table as changed for each statement execute function atlas_account.bump_library();

create function public.atlas_word_page(p_revision text, p_time timestamptz, p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare owner_id uuid := auth.uid(); version text; total bigint; page jsonb; candidate_count integer;
begin
  if owner_id is null or not public.atlas_live_session() then raise insufficient_privilege; end if;
  if (p_time is null) <> (p_id is null) or (p_revision is null) <> (p_id is null)
    then raise exception 'invalid cursor' using errcode='22023'; end if;
  select coalesce((select revision from atlas_account.library_versions where user_id=owner_id),0)::text into version;
  if p_revision is not null and version <> p_revision then raise serialization_failure; end if;
  if p_id is null then select count(*) into total from public.words where user_id=owner_id; end if;
  with candidates as materialized (
    (select id,word,score,content,created_at,updated_at from public.words
      where user_id=owner_id and p_time is null order by updated_at desc,id limit 128)
    union all
    (select id,word,score,content,created_at,updated_at from public.words
      where user_id=owner_id and updated_at=p_time and id>p_id order by id limit 128)
    union all
    (select id,word,score,content,created_at,updated_at from public.words
      where user_id=owner_id and updated_at<p_time order by updated_at desc,id limit 128)
    order by updated_at desc,id limit 128
  ), sized as (
    select to_jsonb(c) item, updated_at,id,
      sum(octet_length(to_jsonb(c)::text)+2) over(order by updated_at desc,id) bytes
    from candidates c
  )
  select coalesce(jsonb_agg(item order by updated_at desc,id) filter(where bytes<=4194304),'[]'),
    count(*) into page, candidate_count from sized;
  if candidate_count>0 and page='[]' then raise program_limit_exceeded; end if;
  return jsonb_build_object('owner',owner_id,'revision',version,'total',total,'rows',page);
end;
$$;
revoke all on function public.atlas_word_page(text,timestamptz,uuid) from public, anon, authenticated, service_role;
grant execute on function public.atlas_word_page(text,timestamptz,uuid) to authenticated;

create table atlas_account.plans (
  user_id uuid primary key references auth.users on delete cascade,
  revision integer not null check(revision > 0),
  document jsonb not null,
  command_id uuid not null,
  fingerprint bytea not null,
  import_signature bytea,
  import_counts jsonb
);
alter table atlas_account.plans enable row level security;
revoke all on atlas_account.plans from public,anon,authenticated,service_role;
grant select on atlas_account.plans to authenticated;
create policy own_plan on atlas_account.plans for select to authenticated using (user_id=(select auth.uid()));
grant select,insert,update on atlas_account.plans to atlas_account_mutator;
create policy mutate_own_plan on atlas_account.plans to atlas_account_mutator
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select(id,user_id) on public.words to atlas_account_mutator;
create policy check_plan_word on public.words for select to atlas_account_mutator using (user_id=(select auth.uid()));

create function public.atlas_read_plan() returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('owner',auth.uid(),'revision',coalesce(p.revision,0),'plan',p.document)
  from (select 1) seed left join atlas_account.plans p on p.user_id=auth.uid()
  where auth.uid() is not null and public.atlas_live_session()
$$;

create function public.atlas_save_plan(p_revision integer,p_command uuid,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); current_plan atlas_account.plans; ids uuid[];
  signature bytea:=sha256(convert_to(jsonb_build_array(p_revision,p_plan)::text,'UTF8'));
begin
  if owner_id is null or not public.atlas_live_session() then raise insufficient_privilege; end if;
  if p_command is null or p_revision is null or p_revision<0 or p_plan is null
     or octet_length(p_plan::text)>1048576 then raise invalid_parameter_value; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text,512));
  select * into current_plan from atlas_account.plans where user_id=owner_id;
  if current_plan.command_id=p_command and current_plan.fingerprint=signature then
    return jsonb_build_object('owner',owner_id,'revision',current_plan.revision,'plan',current_plan.document);
  end if;
  if coalesce(current_plan.revision,0)<>p_revision or current_plan.command_id=p_command then raise serialization_failure; end if;
  if jsonb_typeof(p_plan) is distinct from 'object' or
    (p_plan - array['size','groups','exclusions']) <> '{}' or
    jsonb_typeof(p_plan->'size') is distinct from 'number' or
    (p_plan->>'size') !~ '^[0-9]{2}$' or (p_plan->>'size')::int not between 10 and 40 or
    jsonb_typeof(p_plan->'groups') is distinct from 'array' or jsonb_array_length(p_plan->'groups')>60 or
    jsonb_typeof(p_plan->'exclusions') is distinct from 'array' then raise invalid_parameter_value; end if;
  if exists (select from jsonb_array_elements(p_plan->'groups') g
    where jsonb_typeof(g) is distinct from 'object' or g-array['day','words']<>'{}' or
    jsonb_typeof(g->'day') is distinct from 'number' or (g->>'day') !~ '^[0-9]{1,2}$' or
    (g->>'day')::int not between 1 and 60 or jsonb_typeof(g->'words') is distinct from 'array'
    or jsonb_array_length(g->'words')>40)
    or exists (select from jsonb_array_elements(p_plan->'groups') g group by g->'day' having count(*)>1)
    then raise invalid_parameter_value; end if;
  select coalesce(array_agg(value::uuid),'{}') into ids from (
    select value from jsonb_array_elements_text(p_plan->'exclusions')
    union all select w from jsonb_array_elements(p_plan->'groups') g,
      lateral jsonb_array_elements_text(g->'words') w
  ) refs;
  if cardinality(ids)>27400 or jsonb_array_length(p_plan->'exclusions')>25000 or cardinality(ids) <> (select count(*) from public.words where user_id=owner_id and id=any(ids))
    then raise exception 'duplicate, missing or foreign plan reference' using errcode='40001'; end if;
  insert into atlas_account.plans(user_id,revision,document,command_id,fingerprint) values(owner_id,p_revision+1,p_plan,p_command,signature)
    on conflict(user_id) do update set revision=excluded.revision, document=excluded.document,
      command_id=excluded.command_id,fingerprint=excluded.fingerprint,import_signature=null,import_counts=null;
  return jsonb_build_object('owner',owner_id,'revision',p_revision+1,'plan',p_plan);
end;
$$;
grant create on schema public to atlas_account_mutator;
alter function public.atlas_save_plan(integer,uuid,jsonb) owner to atlas_account_mutator;
revoke create on schema public from atlas_account_mutator;
revoke all on function public.atlas_read_plan(),public.atlas_save_plan(integer,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.atlas_read_plan(),public.atlas_save_plan(integer,uuid,jsonb) to authenticated;

-- Only attach an import acknowledgement to the caller's own plan write in this
-- transaction. Replaying an old command cannot modify an already committed receipt.
create function atlas_account.record_import(p_command uuid,p_signature bytea,p_counts jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  update atlas_account.plans set import_signature=p_signature,import_counts=p_counts
    where user_id=auth.uid() and command_id=p_command and import_signature is null
      and xmin=pg_current_xact_id()::xid;
  if not found then raise serialization_failure; end if;
end;
$$;
grant create on schema atlas_account to atlas_account_mutator;
alter function atlas_account.record_import(uuid,bytea,jsonb) owner to atlas_account_mutator;
revoke create on schema atlas_account from atlas_account_mutator;
revoke all on function atlas_account.record_import(uuid,bytea,jsonb) from public,anon,authenticated,service_role;
grant execute on function atlas_account.record_import(uuid,bytea,jsonb) to authenticated;

-- Import uses the caller's existing column grants and content guard. Build the plan
-- from the submitted base so retry after a lost acknowledgement derives the same IDs.
create function public.atlas_import_to_day(p_revision integer,p_command uuid,p_day integer,p_base jsonb,p_words jsonb,p_create_only boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare state jsonb; counts jsonb; ids jsonb; groups_out jsonb;
  target jsonb; excluded jsonb; result jsonb; signature bytea; receipt atlas_account.plans;
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  if p_revision is null or p_revision<1 or p_day is null or p_day not between 1 and 60
     or jsonb_typeof(p_words) is distinct from 'array' or jsonb_array_length(p_words) not between 1 and 40
     or octet_length(p_words::text)>1500000 or p_base is null or octet_length(p_base::text)>1048576 then raise invalid_parameter_value; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,512));
  state:=public.atlas_read_plan();
  signature:=sha256(convert_to(jsonb_build_array(p_revision,p_day,p_base,p_words,p_create_only)::text,'UTF8'));
  select * into receipt from atlas_account.plans where user_id=auth.uid() and command_id=p_command;
  if found then
    if receipt.import_signature is distinct from signature then raise serialization_failure; end if;
    return state || receipt.import_counts;
  end if;
  if (state->>'revision')::int<>p_revision or p_base is distinct from state->'plan' then raise serialization_failure; end if;
  if p_create_only is null or (p_create_only and jsonb_array_length(p_words)<>1) then raise invalid_parameter_value; end if;
  counts:=public.import_words(p_words);
  if p_create_only and counts->>'added'<>'1' then raise unique_violation; end if;
  select jsonb_agg(to_jsonb(id) order by pos) into ids from (
    select w.id,min(n) pos from jsonb_array_elements(p_words) with ordinality t(item,n)
    join public.words w on w.user_id=auth.uid() and
      lower(regexp_replace(btrim(w.word),'\s+',' ','g'))=lower(regexp_replace(btrim(item->>'word'),'\s+',' ','g'))
    group by w.id
  ) added;
  select coalesce(g->'words','[]') into target from jsonb_array_elements(p_base->'groups') g where (g->>'day')::int=p_day;
  target:=coalesce(target,'[]') || (select coalesce(jsonb_agg(value order by n),'[]')
    from jsonb_array_elements(ids) with ordinality t(value,n) where not coalesce(target,'[]') @> jsonb_build_array(value));
  if jsonb_array_length(target)>40 then raise exception 'day full' using errcode='22023'; end if;
  select coalesce(jsonb_agg(g order by (g->>'day')::int),'[]') into groups_out from (
    select jsonb_build_object('day',g->'day','words',(
      select coalesce(jsonb_agg(v order by n),'[]') from jsonb_array_elements(g->'words') with ordinality t(v,n)
      where not ids @> jsonb_build_array(v))) g from jsonb_array_elements(p_base->'groups') g
      where (g->>'day')::int<>p_day
    union all select jsonb_build_object('day',p_day,'words',target)
  ) days where jsonb_array_length(g->'words')>0;
  select coalesce(jsonb_agg(v order by n),'[]') into excluded from
    jsonb_array_elements(p_base->'exclusions') with ordinality t(v,n) where not ids @> jsonb_build_array(v);
  result:=public.atlas_save_plan(p_revision,p_command,jsonb_build_object('size',p_base->'size','groups',groups_out,'exclusions',excluded));
  perform atlas_account.record_import(p_command,signature,counts);
  return result || counts;
end;
$$;
revoke all on function public.atlas_import_to_day(integer,uuid,integer,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.atlas_import_to_day(integer,uuid,integer,jsonb,jsonb,boolean) to authenticated;

do $$
declare relation regclass;
begin
  foreach relation in array array['public.words'::regclass,'public.profiles','public.learning_sessions',
    'public.learning_results','public.daily_word_completions','public.completed_goal_days',
    'atlas_account.plans','atlas_account.library_versions'] loop
    execute format('create policy live_session on %s as restrictive to authenticated,atlas_account_mutator
      using ((select public.atlas_live_session())) with check ((select public.atlas_live_session()))',relation);
  end loop;
end;
$$;
-- set_daily_goal executes under the learning mutator, while the dedicated assessment
-- connection uses an independently authenticated writer with no end-user JWT.
create policy live_goal_profile on public.profiles as restrictive to atlas_learning_mutator
  using (current_setting('role') <> 'authenticated' or (select public.atlas_live_session()))
  with check (current_setting('role') <> 'authenticated' or (select public.atlas_live_session()));

create function public.atlas_confirm_account(p_owner uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select p_owner=auth.uid() and public.atlas_live_session() and exists (
  select from jsonb_array_elements(nullif(current_setting('request.jwt.claims',true),'')::jsonb->'amr') m
  where m->>'method' in ('password','otp','oauth','totp','webauthn')
    and (m->>'timestamp')::bigint between extract(epoch from now())::bigint-300 and extract(epoch from now())::bigint)
$$;
revoke all on function public.atlas_confirm_account(uuid) from public,anon,authenticated,service_role;
grant execute on function public.atlas_confirm_account(uuid) to authenticated,atlas_account_mutator;

-- Fixed projection using a single stable snapshot. Refuse oversize exports before aggregation.
grant select on public.profiles,public.words,public.learning_sessions,public.learning_results,
  public.daily_word_completions,public.completed_goal_days,public.ai_usage to atlas_account_mutator;
do $$ declare rel regclass;
begin
 foreach rel in array array['public.profiles'::regclass,'public.learning_sessions','public.learning_results',
 'public.daily_word_completions','public.completed_goal_days','public.ai_usage'] loop
  execute format('create policy export_own on %s for select to atlas_account_mutator using (user_id=(select auth.uid()))',rel);
 end loop;
end $$;
create function public.atlas_export_account(p_owner uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb := '{}'::jsonb; counts jsonb := '{}'::jsonb; records jsonb; used bigint:=0; bytes bigint; collection text; projection text; relation text;
begin
 if public.atlas_confirm_account(p_owner) is not true then raise insufficient_privilege; end if;
 for collection,relation,projection in select * from (values
  ('profile','public.profiles','daily_goal,created_at'),
  ('words','public.words','id,word,score,content,created_at,updated_at'),
  ('sessions','public.learning_sessions','id,snapshot,revision,completed_at,updated_at,assessment_protocol'),
  ('results','public.learning_results','session_id,scores,completed_at'),
  ('wordCompletions','public.daily_word_completions','day,word_id'),
  ('goalDays','public.completed_goal_days','day,goal'),
  ('usage','public.ai_usage','bucket,requests'),
  ('plan','atlas_account.plans','revision,document')
 ) allowed loop
  execute format('select coalesce(sum(octet_length(to_jsonb(r)::text)+2),0) from (select %s from %s where user_id=$1) r',projection,relation) into bytes using p_owner;
  used:=used+bytes;
  if used>16777216 then raise exception 'export size limit' using errcode='54000'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]'') from (select %s from %s where user_id=$1) r',projection,relation) into records using p_owner;
  result:=result||jsonb_build_object(collection,records);
  counts:=counts||jsonb_build_object(collection,jsonb_array_length(records));
 end loop;
 return jsonb_build_object('format',1,'owner',p_owner,'at',statement_timestamp(),'data',result,'counts',counts);
end;
$$;
grant create on schema public to atlas_account_mutator;
alter function public.atlas_export_account(uuid) owner to atlas_account_mutator;
revoke create on schema public from atlas_account_mutator;
revoke all on function public.atlas_export_account(uuid) from public,anon,authenticated,service_role;
grant execute on function public.atlas_export_account(uuid) to authenticated;

-- A confirmed library deletion removes precisely its plan references and advances CAS.
create function atlas_account.remove_deleted_assignments() returns trigger
language plpgsql security definer set search_path='' as $$
declare item record; old_plan jsonb; next_groups jsonb; next_exclusions jsonb;
begin
 for item in select user_id,jsonb_agg(id) ids from removed group by user_id order by user_id loop
  perform pg_advisory_xact_lock(hashtextextended(item.user_id::text,512));
  select document into old_plan from atlas_account.plans where user_id=item.user_id for update;
  if not found then continue; end if;
  select coalesce(jsonb_agg(jsonb_build_object('day',day,'words',words) order by ord),'[]') into next_groups from (
   select g->'day' as day,ord,(select coalesce(jsonb_agg(w order by n),'[]')
    from jsonb_array_elements(g->'words') with ordinality t(w,n) where not item.ids ? (w #>> '{}')) words
   from jsonb_array_elements(old_plan->'groups') with ordinality t(g,ord)
  ) days;
  select coalesce(jsonb_agg(w order by n),'[]') into next_exclusions from jsonb_array_elements(old_plan->'exclusions')
    with ordinality t(w,n) where not item.ids ? (w #>> '{}');
  if next_groups<>old_plan->'groups' or next_exclusions<>old_plan->'exclusions' then
    update atlas_account.plans set revision=revision+1,document=document||jsonb_build_object('groups',next_groups,'exclusions',next_exclusions),
      command_id=gen_random_uuid(),fingerprint=''::bytea,import_signature=null,import_counts=null where user_id=item.user_id;
  end if;
 end loop;
 return null;
end;
$$;
revoke all on function atlas_account.remove_deleted_assignments() from public,anon,authenticated,service_role;
create trigger words_remove_plan_refs after delete on public.words referencing old table as removed
 for each statement execute function atlas_account.remove_deleted_assignments();

create role atlas_library_maintenance nologin noinherit;
grant atlas_library_maintenance to postgres with set true;
grant usage on schema auth,atlas_account to atlas_library_maintenance;
grant select(id) on auth.users to atlas_library_maintenance;
create policy atlas_version_parent on auth.users for select to atlas_library_maintenance using(true);
grant select,insert,update on atlas_account.library_versions to atlas_library_maintenance;
grant select,update on atlas_account.plans to atlas_library_maintenance;
create policy maintain_versions on atlas_account.library_versions to atlas_library_maintenance using(true) with check(true);
create policy maintain_plan_references on atlas_account.plans to atlas_library_maintenance using(true) with check(true);
grant create on schema atlas_account to atlas_library_maintenance;
alter function atlas_account.bump_library() owner to atlas_library_maintenance;
alter function atlas_account.remove_deleted_assignments() owner to atlas_library_maintenance;
revoke create on schema atlas_account from atlas_library_maintenance;
