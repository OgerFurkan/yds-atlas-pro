-- Deploy only after every Bun replica opens accounts without upserting profiles.
revoke insert, update on table public.profiles from authenticated;

do $$
begin
  if exists (
    select from (values ('anon'), ('authenticated')) roles(name)
    where has_any_column_privilege(name, 'public.profiles', 'INSERT')
       or has_any_column_privilege(name, 'public.profiles', 'UPDATE')
  ) then
    raise exception 'Unexpected effective profile writer. Review inherited and column grants.';
  end if;
end;
$$;
