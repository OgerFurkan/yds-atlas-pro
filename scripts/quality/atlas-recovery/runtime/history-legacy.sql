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
  SELECT d.classid,d.objid FROM pg_depend d
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
  SELECT 'pg_constraint'::regclass::oid,q.oid,0,NULL::oid,NULL::aclitem[],NULL::"char"
  FROM pg_constraint q JOIN pg_namespace n ON n.oid=q.connamespace
  WHERE q.conrelid<>0 AND n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
  UNION ALL
  SELECT 'pg_proc'::regclass::oid,p.oid,0,p.proowner,p.proacl,'f'::"char"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prokind IN ('f','p') AND n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
),
identified AS (
  SELECT o.*, i.type, i.schema, i.identity,
    CASE WHEN i.identity IS NULL THEN 'unknown'
      WHEN EXISTS(SELECT 1 FROM members m WHERE (m.classid,m.objid)=(o.classid,o.objid)) THEN 'extension_member'
      WHEN EXISTS(SELECT 1 FROM reachable r WHERE (r.classid,r.objid)=(o.classid,o.objid)) THEN 'extension_dependent'
      WHEN i.schema='prototype_app' OR (i.type='schema' AND i.name='prototype_app') THEN 'application'
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
SELECT line FROM evidence ORDER BY line COLLATE "C";
