SELECT format($q$SELECT %L || '|' || last_value || '|' || is_called FROM %I.%I$q$,
 'seq:' || encode(sha256(convert_to(format('%I.%I',n.nspname,c.relname),'UTF8')),'hex'),n.nspname,c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
 ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"
\gexec
