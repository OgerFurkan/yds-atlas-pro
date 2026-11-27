SET search_path = pg_catalog, public;
SET TIME ZONE 'UTC';
SET datestyle = 'ISO, YMD';
SET intervalstyle = 'postgres';
SET extra_float_digits = 3;
SET bytea_output = 'hex';

WITH RECURSIVE
members(classid,objid) AS (
  SELECT d.classid,d.objid FROM pg_depend d
  WHERE d.deptype='e' AND d.refclassid='pg_extension'::regclass
  UNION
  SELECT 'pg_extension'::regclass::oid, oid FROM pg_extension
),
reachable(classid,objid) AS (
  SELECT classid,objid FROM members
  UNION
  SELECT d.classid,d.objid FROM (
    SELECT classid,objid,refclassid,refobjid,deptype FROM pg_depend
    UNION ALL
    SELECT 'pg_class'::regclass::oid,r.ev_class,'pg_rewrite'::regclass::oid,r.oid,'i'::"char"
    FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
    WHERE r.rulename='_RETURN' AND c.relkind IN ('v','m')
  ) d
  JOIN reachable r ON (d.refclassid,d.refobjid)=(r.classid,r.objid)
  WHERE d.deptype IN ('e','x','n','a','i','P','S')
),
toast_identity(objid,identity) AS (
  -- TOAST relation and index names embed the parent OID, which changes when
  -- restoring. Keep their edges, keyed by kind and stable parent identity.
  SELECT c.reltoastrelid, jsonb_build_array('toast_table',n.nspname,c.relname)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.reltoastrelid<>0
  UNION ALL
  SELECT i.indexrelid, jsonb_build_array('toast_index',n.nspname,c.relname)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_index i ON i.indrelid=c.reltoastrelid
  WHERE c.reltoastrelid<>0
),
objects(classid,objid,subid,owner_id,acl,acl_kind) AS (
  SELECT 'pg_namespace'::regclass::oid,n.oid,0,n.nspowner,n.nspacl,'n'::"char"
  FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
  UNION ALL
  SELECT 'pg_extension'::regclass::oid,e.oid,0,e.extowner,NULL::aclitem[],NULL::"char" FROM pg_extension e
  UNION ALL
  SELECT 'pg_class'::regclass::oid,c.oid,0,c.relowner,c.relacl,
    (CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END)::"char"
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','f','S') AND n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
  UNION ALL
  SELECT 'pg_class'::regclass::oid,c.oid,a.attnum,c.relowner,a.attacl,'c'::"char"
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
  UNION ALL
  SELECT 'pg_constraint'::regclass::oid,q.oid,0,c.relowner,NULL::aclitem[],NULL::"char"
  FROM pg_constraint q JOIN pg_class c ON c.oid=q.conrelid JOIN pg_namespace n ON n.oid=q.connamespace
  WHERE q.conrelid<>0 AND n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
  UNION ALL
  SELECT 'pg_proc'::regclass::oid,p.oid,0,p.proowner,p.proacl,'f'::"char"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
  UNION ALL
  SELECT 'pg_type'::regclass::oid,t.oid,0,t.typowner,t.typacl,'T'::"char"
  FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
  UNION ALL
  SELECT 'pg_policy'::regclass::oid,p.oid,0,c.relowner,NULL::aclitem[],NULL::"char"
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
  UNION ALL
  SELECT 'pg_trigger'::regclass::oid,t.oid,0,c.relowner,NULL::aclitem[],NULL::"char"
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
  UNION ALL
  SELECT DISTINCT d.classid,d.objid,0,s.refobjid,NULL::aclitem[],NULL::"char"
  FROM pg_depend d JOIN pg_namespace n ON d.refobjid=n.oid
  LEFT JOIN pg_shdepend s ON s.classid=d.classid AND s.objid=d.objid AND s.objsubid=0
    AND s.dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND s.refclassid='pg_authid'::regclass AND s.deptype='o'
  WHERE d.refclassid='pg_namespace'::regclass AND d.objsubid=0
    AND d.classid NOT IN ('pg_namespace'::regclass,'pg_class'::regclass,'pg_proc'::regclass,
      'pg_constraint'::regclass,'pg_type'::regclass,'pg_extension'::regclass,
      'pg_policy'::regclass,'pg_trigger'::regclass)
    AND left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
),
identified AS (
  SELECT o.*, i.type, i.schema, i.identity,
    CASE WHEN i.identity IS NULL THEN 'unknown'
      WHEN EXISTS(SELECT 1 FROM members m WHERE (m.classid,m.objid)=(o.classid,o.objid)) THEN 'extension_member'
      WHEN EXISTS(SELECT 1 FROM reachable r WHERE (r.classid,r.objid)=(o.classid,o.objid)) THEN 'extension_dependent'
      WHEN (i.schema,pg_get_userbyid(o.owner_id)) IN
        (('auth','supabase_auth_admin'),('storage','supabase_storage_admin'),
         ('realtime','supabase_realtime_admin'),('realtime','supabase_admin'),
         ('pgbouncer','supabase_admin'),('pgbouncer','pgbouncer'),
         ('graphql','supabase_admin'),('graphql_public','supabase_admin'),
         ('supabase_migrations','supabase_admin')) THEN 'provider_managed'
      WHEN i.type='schema' AND (i.name,pg_get_userbyid(o.owner_id)) IN
        (('auth','supabase_auth_admin'),('storage','supabase_storage_admin'),
         ('realtime','supabase_realtime_admin'),('pgbouncer','pgbouncer'),
         ('auth','supabase_admin'),('storage','supabase_admin'),
         ('realtime','supabase_admin'),('pgbouncer','supabase_admin'),
         ('graphql','supabase_admin'),('graphql_public','supabase_admin'),
         ('supabase_migrations','supabase_admin'),('supabase_migrations','postgres'),
         ('extensions','supabase_admin'),('extensions','postgres'),
         ('vault','supabase_admin')) THEN 'provider_managed'
      WHEN i.schema='supabase_migrations' AND i.type IN ('table','table column')
        AND i.identity IN ('supabase_migrations.schema_migrations',
        'supabase_migrations.schema_migrations.version','supabase_migrations.schema_migrations.statements',
        'supabase_migrations.schema_migrations.name')
        AND pg_get_userbyid(o.owner_id)='postgres' THEN 'provider_managed'
      WHEN (i.schema='public' AND pg_get_userbyid(o.owner_id)='postgres')
        OR (i.type='schema' AND i.name='public' AND pg_get_userbyid(o.owner_id) IN ('postgres','pg_database_owner'))
        THEN 'application'
      ELSE 'unknown' END AS scope
  FROM objects o CROSS JOIN LATERAL pg_identify_object(o.classid,o.objid,o.subid) i
),
evidence(line) AS (
  SELECT 'E|' || jsonb_build_array(e.extname,n.nspname,e.extversion,pg_get_userbyid(e.extowner))::text
  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
  UNION ALL
  SELECT 'O|' || jsonb_build_array(type,identity,pg_get_userbyid(owner_id),scope,subid)::text FROM identified
  UNION ALL
  SELECT 'A|' || jsonb_build_array(i.type,i.identity,pg_get_userbyid(i.owner_id),
    pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN NULL ELSE pg_get_userbyid(a.grantee) END,
    a.privilege_type,a.is_grantable)::text
  FROM identified i CROSS JOIN LATERAL aclexplode(COALESCE(i.acl,acldefault(i.acl_kind,i.owner_id))) a
  UNION ALL
  SELECT 'A|' || jsonb_build_array('default',n.nspname,d.defaclobjtype,pg_get_userbyid(d.defaclrole),
    pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN NULL ELSE pg_get_userbyid(a.grantee) END,
    a.privilege_type,a.is_grantable)::text
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  UNION ALL
  SELECT 'M|' || jsonb_build_array(pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor),
    admin_option,inherit_option,set_option)::text FROM pg_auth_members
  UNION ALL
  SELECT 'D|' || jsonb_build_array(a.type,COALESCE(ta.identity,a.identity),d.objsubid,
    b.type,COALESCE(tb.identity,b.identity),d.refobjsubid,d.deptype)::text
  FROM pg_depend d JOIN reachable r ON (d.refclassid,d.refobjid)=(r.classid,r.objid)
  CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) a
  CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) b
  LEFT JOIN toast_identity ta ON d.classid='pg_class'::regclass AND ta.objid=d.objid
  LEFT JOIN toast_identity tb ON d.refclassid='pg_class'::regclass AND tb.objid=d.refobjid
  UNION ALL
  SELECT 'T|' || jsonb_build_array(i.type,COALESCE(t.identity,i.identity),
    CASE WHEN i.identity IS NULL THEN 'unknown'
      WHEN EXISTS(SELECT 1 FROM members m WHERE (m.classid,m.objid)=(r.classid,r.objid))
      THEN 'extension_member' ELSE 'extension_dependent' END)::text
  FROM reachable r CROSS JOIN LATERAL pg_identify_object(r.classid,r.objid,0) i
  LEFT JOIN toast_identity t ON r.classid='pg_class'::regclass AND t.objid=r.objid
  UNION ALL
  -- The only preinstalled extension in these fresh clusters is plpgsql.
  -- Its version and owner are still compared above. Pin every other extension.
  SELECT 'P|' || e.extname || ':' || n.nspname || ':' || e.extversion || ':' || pg_get_userbyid(e.extowner)
  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname <> 'plpgsql'
)
SELECT line FROM (SELECT line FROM evidence UNION ALL
 SELECT 'U|unresolved_dependency' WHERE EXISTS (
  SELECT 1 FROM pg_depend d JOIN reachable r ON (d.refclassid,d.refobjid)=(r.classid,r.objid)
  CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) a
  CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) b
  WHERE (a.identity IS NULL AND NOT EXISTS (SELECT 1 FROM toast_identity t
    WHERE d.classid='pg_class'::regclass AND t.objid=d.objid))
     OR (b.identity IS NULL AND NOT EXISTS (SELECT 1 FROM toast_identity t
    WHERE d.refclassid='pg_class'::regclass AND t.objid=d.refobjid)))) verified
ORDER BY line COLLATE "C";
-- Keep owner and parsed ACL evidence for direct extension members outside
-- the original object's scope. Unknown catalog classes prevent acceptance.
WITH member AS (
  SELECT e.extname, d.classid, d.objid, d.objsubid, o.type, o.identity
  FROM pg_depend d JOIN pg_extension e ON d.refobjid=e.oid
  CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) o
  WHERE d.refclassid='pg_extension'::regclass AND d.deptype='e'
), owned AS (
  SELECT 'pg_proc'::regclass AS classid, oid, proowner AS owner, proacl AS acl, 'f'::"char" AS kind FROM pg_proc
  UNION ALL SELECT 'pg_language'::regclass, oid, lanowner, lanacl, 'l' FROM pg_language
  UNION ALL SELECT 'pg_type'::regclass, oid, typowner, typacl, 'T' FROM pg_type
  UNION ALL SELECT 'pg_namespace'::regclass, oid, nspowner, nspacl, 'n' FROM pg_namespace
  UNION ALL SELECT 'pg_class'::regclass, oid, relowner, relacl, (CASE WHEN relkind='S' THEN 's' ELSE 'r' END)::"char" FROM pg_class
  UNION ALL SELECT 'pg_operator'::regclass, oid, oprowner, NULL, NULL FROM pg_operator
  UNION ALL SELECT 'pg_opclass'::regclass, oid, opcowner, NULL, NULL FROM pg_opclass
  UNION ALL SELECT 'pg_opfamily'::regclass, oid, opfowner, NULL, NULL FROM pg_opfamily
  UNION ALL SELECT 'pg_collation'::regclass, oid, collowner, NULL, NULL FROM pg_collation
  UNION ALL SELECT 'pg_conversion'::regclass, oid, conowner, NULL, NULL FROM pg_conversion
  UNION ALL SELECT 'pg_ts_config'::regclass, oid, cfgowner, NULL, NULL FROM pg_ts_config
  UNION ALL SELECT 'pg_ts_dict'::regclass, oid, dictowner, NULL, NULL FROM pg_ts_dict
  UNION ALL SELECT 'pg_event_trigger'::regclass, oid, evtowner, NULL, NULL FROM pg_event_trigger
  UNION ALL SELECT 'pg_foreign_data_wrapper'::regclass, oid, fdwowner, fdwacl, 'F' FROM pg_foreign_data_wrapper
), member_evidence AS (
  SELECT 'X|' || jsonb_build_array(m.extname,m.type,m.identity,pg_get_userbyid(o.owner))::text AS line
  FROM member m LEFT JOIN owned o USING(classid)
  WHERE o.oid=m.objid
  UNION ALL
  SELECT 'A|' || jsonb_build_array('extension member',m.extname,m.type,m.identity,pg_get_userbyid(o.owner),
      pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN NULL ELSE pg_get_userbyid(a.grantee) END,
      a.privilege_type,a.is_grantable)::text
  FROM member m JOIN owned o ON (o.classid,o.oid)=(m.classid,m.objid)
  CROSS JOIN LATERAL aclexplode(COALESCE(o.acl,acldefault(o.kind,o.owner))) a
  UNION ALL
  SELECT 'U|unresolved_extension_member'
  WHERE EXISTS (SELECT 1 FROM member m LEFT JOIN owned o ON (o.classid,o.oid)=(m.classid,m.objid)
    WHERE m.identity IS NULL OR m.objsubid<>0 OR (o.oid IS NULL AND m.classid NOT IN
      ('pg_cast'::regclass,'pg_am'::regclass,'pg_amop'::regclass,'pg_amproc'::regclass,'pg_transform'::regclass,
       'pg_ts_parser'::regclass,'pg_ts_template'::regclass,'pg_trigger'::regclass,'pg_policy'::regclass,'pg_rewrite'::regclass)))
)
SELECT line FROM member_evidence ORDER BY line COLLATE "C";
