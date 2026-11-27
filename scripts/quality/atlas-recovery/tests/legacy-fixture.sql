CREATE ROLE prototype_owner NOLOGIN;
CREATE ROLE prototype_authenticated NOLOGIN;
CREATE ROLE prototype_allowed NOLOGIN;
CREATE ROLE prototype_denied NOLOGIN;
CREATE ROLE prototype_marker NOLOGIN;
CREATE ROLE prototype_anon NOLOGIN;
CREATE ROLE prototype_authenticator LOGIN NOINHERIT;
GRANT prototype_marker TO prototype_authenticated WITH ADMIN TRUE, INHERIT TRUE, SET FALSE;
GRANT prototype_authenticated, prototype_anon TO prototype_authenticator WITH INHERIT FALSE, SET TRUE;
CREATE SCHEMA prototype_app AUTHORIZATION prototype_owner;
CREATE SCHEMA prototype_ext;
CREATE SCHEMA prototype_unmapped;
CREATE SCHEMA prototype_auth;
CREATE EXTENSION hstore WITH SCHEMA prototype_ext VERSION '1.7';
CREATE TABLE prototype_app.extension_ref (value prototype_ext.hstore);
CREATE TABLE prototype_unmapped.unknown_type (n integer);
CREATE TABLE prototype_auth.accounts(id uuid PRIMARY KEY);
INSERT INTO prototype_auth.accounts VALUES
 ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
CREATE FUNCTION prototype_auth.subject() RETURNS uuid LANGUAGE sql STABLE
 SET search_path = pg_catalog AS $$
 SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
 $$;
GRANT USAGE ON SCHEMA prototype_auth TO prototype_authenticated, prototype_owner;
GRANT REFERENCES ON prototype_auth.accounts TO prototype_owner;
SET ROLE prototype_owner;
CREATE TABLE prototype_app.words (
 id serial PRIMARY KEY, owner_id uuid REFERENCES prototype_auth.accounts(id),
 score int NOT NULL CHECK(score>=0), label text NOT NULL, touched int NOT NULL DEFAULT 0
);
CREATE FUNCTION prototype_app.bump() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$BEGIN NEW.touched=NEW.touched+1; RETURN NEW; END$$;
CREATE TRIGGER bump BEFORE INSERT OR UPDATE ON prototype_app.words FOR EACH ROW EXECUTE FUNCTION prototype_app.bump();
ALTER TABLE prototype_app.words ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_own ON prototype_app.words FOR SELECT TO prototype_authenticated
 USING(owner_id=prototype_auth.subject());
CREATE POLICY edit_own ON prototype_app.words FOR UPDATE TO prototype_authenticated
 USING(owner_id=prototype_auth.subject()) WITH CHECK(owner_id=prototype_auth.subject());
GRANT USAGE ON SCHEMA prototype_app TO prototype_authenticated,prototype_allowed,prototype_denied;
GRANT SELECT ON prototype_app.words TO prototype_authenticated;
GRANT UPDATE(label) ON prototype_app.words TO prototype_authenticated;
CREATE TABLE prototype_app.private(n integer NOT NULL);
INSERT INTO prototype_app.private VALUES (87);
CREATE FUNCTION prototype_app.read_private() RETURNS integer SECURITY DEFINER LANGUAGE sql
 SET search_path = pg_catalog, prototype_app AS $$SELECT n FROM prototype_app.private$$;
REVOKE ALL ON FUNCTION prototype_app.read_private() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prototype_app.read_private() TO prototype_allowed;
INSERT INTO prototype_app.words(owner_id,score,label) VALUES
 ('10000000-0000-0000-0000-000000000001',87,'synthetic a'),
 ('10000000-0000-0000-0000-000000000002',42,'synthetic b');
RESET ROLE;
