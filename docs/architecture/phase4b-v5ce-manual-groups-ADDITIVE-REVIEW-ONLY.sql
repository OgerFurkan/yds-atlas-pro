-- PHASE 4B v5C-E / REVIEW ONLY / DO NOT APPLY AUTOMATICALLY.
-- ADDITIVE. Does not close or modify legacy score-writing privileges.
-- Run in disposable Postgres first. A separate coordinated cutover is required
-- before public.words.score becomes verified / service-writer-only.

alter table public.words
  add column if not exists manual_group text null
  constraint words_manual_group_valid check (manual_group in ('hard', 'review', 'learned'));

create or replace function public.set_word_groups_v7(p_groups jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $v7$
declare
  v_count integer;
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_groups) is distinct from 'array' or
     jsonb_array_length(p_groups) < 1 or jsonb_array_length(p_groups) > 500 then
    raise exception 'invalid groups' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_groups);
  if (select count(distinct x.id) from jsonb_to_recordset(p_groups)
        as x(id uuid, group_name text)) <> v_count or
     exists (select 1 from jsonb_to_recordset(p_groups)
        as x(id uuid, group_name text)
        where x.id is null or x.group_name is null or
          x.group_name not in ('hard','review','learned')) then
    raise exception 'invalid or duplicate group assignment' using errcode = '22023';
  end if;

  -- Invoker + words_owner RLS. No score column or result ledger is changed.
  update public.words w
     set manual_group = x.group_name, updated_at = now()
    from jsonb_to_recordset(p_groups) as x(id uuid, group_name text)
   where w.id = x.id and w.user_id = auth.uid();
  get diagnostics v_updated = row_count;
  -- Abort atomically if ANY requested word is absent or belongs to another owner.
  if v_updated <> v_count then
    raise exception 'word not found or forbidden' using errcode = '42501';
  end if;
  return v_updated;
end;
$v7$;

revoke all on function public.set_word_groups_v7(jsonb)
  from PUBLIC, anon, authenticated;
grant execute on function public.set_word_groups_v7(jsonb)
  to authenticated;

-- Important: this is NOT the final security cutover. Do not revoke words
-- INSERT/UPDATE or apply_word_scores/import_words permissions in this file.
