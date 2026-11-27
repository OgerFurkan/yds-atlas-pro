SET search_path = pg_catalog, public;
SET TIME ZONE 'UTC';
SET datestyle = 'ISO, YMD';
SET intervalstyle = 'postgres';
SET extra_float_digits = 3;
SET bytea_output = 'hex';
WITH r AS (
 SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
        rolreplication, rolconnlimit, rolvaliduntil, rolbypassrls, rolconfig
 FROM pg_roles WHERE rolname NOT LIKE 'pg\_%' AND rolname <> 'atlas_restore_owner'
)
SELECT 'roles|' || count(*) || '|' || encode(sha256(convert_to(coalesce(
 string_agg(to_jsonb(r)::text, E'\n' ORDER BY rolname COLLATE "C"), ''), 'UTF8')), 'hex') FROM r;
WITH m AS (
 SELECT CASE WHEN roleid < 16384 AND member < 16384 THEN 'builtin'
             ELSE grantor::regrole::text END AS grantor, roleid::regrole::text AS role,
  member::regrole::text AS member, admin_option, inherit_option, set_option
 FROM pg_auth_members WHERE member::regrole::text <> 'atlas_restore_owner'
)
SELECT 'members|' || count(*) || '|' || encode(sha256(convert_to(coalesce(
 string_agg(to_jsonb(m)::text, E'\n' ORDER BY to_jsonb(m)::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM m;
WITH objects AS (
 SELECT jsonb_build_array('schema', nspname, nspowner::regrole::text, nspacl::text) AS v
 FROM pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
 UNION ALL
 SELECT jsonb_build_array('extension', extname, extversion, extnamespace::regnamespace::text) FROM pg_extension
 UNION ALL
 SELECT jsonb_build_array('table', n.nspname, c.relname, c.relkind, c.relowner::regrole::text,
  c.relacl::text, c.relrowsecurity, c.relforcerowsecurity)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','S','f')
 UNION ALL
 SELECT jsonb_build_array('column', n.nspname, c.relname, a.attname, format_type(a.atttypid,a.atttypmod),
  a.attnotnull, a.attidentity, a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
  ARRAY(SELECT x::text FROM unnest(a.attacl) AS x ORDER BY x::text COLLATE "C"))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT jsonb_build_array('defaultacl',d.defaclrole::regrole::text,n.nspname,d.defaclobjtype,
  ARRAY(SELECT x::text FROM unnest(d.defaclacl) AS x ORDER BY x::text COLLATE "C"))
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 UNION ALL
 SELECT jsonb_build_array('view',n.nspname,c.relname,pg_get_viewdef(c.oid,false),
  ARRAY(SELECT x FROM unnest(c.reloptions) AS x ORDER BY x COLLATE "C"))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('v','m')
 UNION ALL
 SELECT jsonb_build_array('policy',schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check) FROM pg_policies
 UNION ALL
 SELECT jsonb_build_array('constraint',n.nspname,c.relname,x.conname,pg_get_constraintdef(x.oid))
 FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
 UNION ALL
 SELECT jsonb_build_array('routine',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),
  p.proowner::regrole::text,p.proacl::text,pg_get_functiondef(p.oid))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' AND p.prokind IN ('f','p')
 UNION ALL
 SELECT jsonb_build_array('index',schemaname,tablename,indexname,indexdef)
 FROM pg_indexes WHERE schemaname NOT LIKE 'pg\_%' AND schemaname <> 'information_schema'
 UNION ALL
 SELECT jsonb_build_array('trigger',n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid))
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' AND NOT t.tgisinternal
)
 , catalog_kinds(kind) AS (VALUES ('schema'),('extension'),('table'),('column'),('defaultacl'),('view'),('policy'),('constraint'),('routine'),('index'),('trigger')),
 catalog_digests AS (
 SELECT 'catalog' AS k, count(*) AS n, encode(sha256(convert_to(coalesce(
 string_agg(v::text, E'\n' ORDER BY v::text COLLATE "C"), ''), 'UTF8')), 'hex') AS digest FROM objects
 UNION ALL
 SELECT 'catalog:' || g.kind, count(o.v), encode(sha256(convert_to(coalesce(
 string_agg(o.v::text, E'\n' ORDER BY o.v::text COLLATE "C"), ''), 'UTF8')), 'hex')
 FROM catalog_kinds g LEFT JOIN objects o ON o.v->>0=g.kind GROUP BY g.kind
 )
 SELECT k || '|' || n || '|' || digest FROM catalog_digests ORDER BY k COLLATE "C";
WITH lo AS (
 SELECT oid, lomowner::regrole::text AS owner, lomacl::text AS acl, encode(sha256(lo_get(oid)),'hex') AS digest
 FROM pg_largeobject_metadata
)
SELECT 'largeobjects|' || count(*) || '|' || encode(sha256(convert_to(coalesce(
 string_agg(to_jsonb(lo)::text, E'\n' ORDER BY oid), ''), 'UTF8')), 'hex') FROM lo;
SELECT format($q$SELECT %L || '|' || count(*) || '|' || encode(sha256(convert_to(
 coalesce(string_agg(d, '' ORDER BY d COLLATE "C"), ''), 'UTF8')), 'hex')
 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS d FROM ONLY %I.%I t) rows$q$,
 'table:' || encode(sha256(convert_to(format('%I.%I', n.nspname,c.relname),'UTF8')),'hex'),n.nspname,c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
 ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"
\gexec
