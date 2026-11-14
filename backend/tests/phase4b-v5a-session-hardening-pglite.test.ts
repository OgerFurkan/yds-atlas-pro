import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Local-only characterization + hardening test, NOT a concurrency proof.
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const aliceWord = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const aliceSession = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bobSession = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const pendingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
let beforePrivileges: { authInsert: boolean; authUpdate: boolean; oldRpc: boolean } | null = null;
let directTamperSucceeded = false;

const sample = (id: string) => ({
  id, version: 3, tutorial: false, phase: "meaning", queue: [], words: [],
});

async function asRole<T>(role: "authenticated" | "anon" | "service_role", userId: string | null, work: () => Promise<T>) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try { return await work(); }
  finally { await db.exec("reset role"); }
}

async function rights() {
  const { rows } = await db.query<{
    authInsert: boolean; authUpdate: boolean; authSelect: boolean; oldRpc: boolean;
    v5Auth: boolean; v5Anon: boolean; v5Service: boolean;
  }>(`select
    has_table_privilege('authenticated','public.learning_sessions','INSERT') as "authInsert",
    has_table_privilege('authenticated','public.learning_sessions','UPDATE') as "authUpdate",
    has_table_privilege('authenticated','public.learning_sessions','SELECT') as "authSelect",
    has_function_privilege('authenticated','public.save_learning_session(uuid,jsonb,integer)','EXECUTE') as "oldRpc",
    has_function_privilege('authenticated','public.save_learning_session_v5(uuid,uuid,jsonb,integer)','EXECUTE') as "v5Auth",
    has_function_privilege('anon','public.save_learning_session_v5(uuid,uuid,jsonb,integer)','EXECUTE') as "v5Anon",
    has_function_privilege('service_role','public.save_learning_session_v5(uuid,uuid,jsonb,integer)','EXECUTE') as "v5Service"`);
  return rows[0];
}

async function save(id: string, snapshot: unknown, revision: number, ownerId = alice) {
  const { rows } = await db.query<{ value: number }>(
    "select public.save_learning_session_v5($1::uuid,$2::uuid,$3::jsonb,$4::integer) as value",
    [ownerId, id, JSON.stringify(snapshot), revision],
  );
  return rows[0]?.value;
}

beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; " +
    "create schema auth; create table auth.users(id uuid primary key); " +
    "create function auth.uid() returns uuid language sql stable as $$ " +
    "select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; " +
    "grant usage on schema auth to anon,authenticated,service_role;",
  );
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter((entry) => entry.endsWith(".sql")).sort()) {
    await db.exec((await Bun.file(new URL(name, migrations)).text()).replace(/^\uFEFF/, ""));
  }
  // The test role has no Supabase-managed grants; copy the verified service-role
  // ACLs inside PGlite only. BYPASSRLS does not bypass table ACL checks.
  await db.exec(`grant usage on schema public to service_role;
    grant all privileges on table public.learning_results,public.learning_sessions,
      public.words,public.word_review_schedules,public.daily_word_completions,
      public.completed_goal_days,public.profiles to service_role;`);
  const v3 = await Bun.file(new URL("../../docs/architecture/phase4b-v3-atomic-completion-DRAFT.sql", import.meta.url)).text();
  await db.exec(v3.replace(/^\uFEFF/, ""));
  const v4 = await Bun.file(new URL("../../docs/architecture/phase4b-v4-legacy-cutover-REVIEW-ONLY.sql", import.meta.url)).text();
  await db.exec(v4.replace(/^\uFEFF/, ""));

  // Demonstrate real vulnerability BEFORE applying v5A, only in disposable PGlite.
  await db.query("insert into auth.users(id) values($1),($2)", [alice, bob]);
  await db.query("insert into public.learning_sessions(id,user_id,snapshot,revision) values($1,$2,$3::jsonb,1)",
    [aliceSession, alice, JSON.stringify(sample(aliceSession))]);
  const pre = await db.query<{ authInsert: boolean; authUpdate: boolean; oldRpc: boolean }>(`select
    has_table_privilege('authenticated','public.learning_sessions','INSERT') as "authInsert",
    has_table_privilege('authenticated','public.learning_sessions','UPDATE') as "authUpdate",
    has_function_privilege('authenticated','public.save_learning_session(uuid,jsonb,integer)','EXECUTE') as "oldRpc"`);
  beforePrivileges = pre.rows[0] ?? null;
  await asRole("authenticated", alice, async () => {
    const changed = await db.query<{ snapshot: { assessment: { forged: boolean } } }>(
      "update public.learning_sessions set snapshot=jsonb_set(snapshot, '{assessment}', '{\"forged\":true}'::jsonb) where id=$1 returning snapshot",
      [aliceSession],
    );
    directTamperSucceeded = changed.rows[0]?.snapshot?.assessment?.forged === true;
  });

  const writer = await Bun.file(new URL("../../docs/architecture/phase4b-v5a-session-writer-REVIEW-ONLY.sql", import.meta.url)).text();
  await db.exec(writer.replace(/^\uFEFF/, ""));
  const cutover = await Bun.file(new URL("../../docs/architecture/phase4b-v5a-session-cutover-REVIEW-ONLY.sql", import.meta.url)).text();
  await db.exec(cutover.replace(/^\uFEFF/, ""));
}, 60_000);

beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade");
  await db.query("insert into auth.users(id) values($1),($2)", [alice, bob]);
  await db.query("insert into public.words(id,user_id,word) values($1,$2,'Evidence')", [aliceWord, alice]);
  await db.query("insert into public.profiles(user_id,daily_goal) values($1,20),($2,20)", [alice, bob]);
});
afterAll(async () => { await db.close(); });

describe("Phase 4B v5A session integrity (isolated PGlite ONLY)", () => {
  test("pre-cutover direct owner snapshot mutation was possible", () => {
    expect(beforePrivileges).toMatchObject({ authInsert: true, authUpdate: true, oldRpc: true });
    expect(directTamperSucceeded).toBe(true);
  });

  test("cutover preserves owner reads, revokes direct DML and old user save RPC", async () => {
    expect(await rights()).toMatchObject({
      authInsert: false, authUpdate: false, authSelect: true,
      oldRpc: false, v5Auth: false, v5Anon: false, v5Service: true,
    });
  });

  test("signed-in user cannot directly insert or update a session", async () => {
    await db.query("insert into public.learning_sessions(id,user_id,snapshot) values($1,$2,$3::jsonb)",
      [aliceSession, alice, JSON.stringify(sample(aliceSession))]);
    await asRole("authenticated", alice, async () => {
      await expect(db.query("update public.learning_sessions set revision=999 where id=$1", [aliceSession])).rejects.toThrow();
      await expect(db.query("insert into public.learning_sessions(id,user_id,snapshot) values($1,$2,$3::jsonb)",
        [pendingId, alice, JSON.stringify(sample(pendingId))])).rejects.toThrow();
      const { rows } = await db.query("select * from public.learning_sessions");
      expect(rows).toHaveLength(1);
    });
  });

  test("authenticated and anon users cannot call old or new writer RPCs", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      await asRole(role, role === "authenticated" ? alice : null, async () => {
        await expect(db.query("select public.save_learning_session($1::uuid,$2::jsonb,0)",
          [pendingId, JSON.stringify(sample(pendingId))])).rejects.toThrow();
        await expect(save(pendingId, sample(pendingId), 0)).rejects.toThrow();
      });
    }
  });

  test("service-only save creates and advances the CAS revision without another owner", async () => {
    await asRole("service_role", null, async () => {
      expect(await save(aliceSession, sample(aliceSession), 0)).toBe(1);
      expect(await save(aliceSession, { ...sample(aliceSession), phase: "context" }, 1)).toBe(2);
      await expect(save(aliceSession, sample(aliceSession), 1)).rejects.toThrow();
      await expect(save(aliceSession, sample(aliceSession), 0)).rejects.toThrow();
    });
    const { rows } = await db.query<{ user_id: string; revision: number }>(
      "select user_id,revision from public.learning_sessions where id=$1", [aliceSession]);
    expect(rows).toMatchObject([{ user_id: alice, revision: 2 }]);
  });

  test("service writer cannot update another owner's session ID", async () => {
    await db.query("insert into public.learning_sessions(id,user_id,snapshot) values($1,$2,$3::jsonb)",
      [bobSession, bob, JSON.stringify(sample(bobSession))]);
    await asRole("service_role", null, async () => {
      await expect(save(bobSession, sample(bobSession), 1, alice)).rejects.toThrow();
    });
    const { rows } = await db.query<{ revision: number }>(
      "select revision from public.learning_sessions where id=$1", [bobSession]);
    expect(rows[0]?.revision).toBe(1);
  });

  test("bad snapshot IDs, tutorials and completed sessions fail closed", async () => {
    await asRole("service_role", null, async () => {
      await expect(save(aliceSession, { ...sample(aliceSession), id: bobSession }, 0)).rejects.toThrow();
      await expect(save(aliceSession, { ...sample(aliceSession), tutorial: true }, 0)).rejects.toThrow();
      expect(await save(aliceSession, sample(aliceSession), 0)).toBe(1);
    });
    await db.query("update public.learning_sessions set completed_at=now() where id=$1", [aliceSession]);
    await asRole("service_role", null, async () => {
      await expect(save(aliceSession, sample(aliceSession), 1)).rejects.toThrow();
    });
  });

  test("owner JWT can still SELECT own sessions, never other account sessions", async () => {
    await db.query("insert into public.learning_sessions(id,user_id,snapshot) values($1,$2,$3::jsonb),($4,$5,$6::jsonb)",
      [aliceSession, alice, JSON.stringify(sample(aliceSession)), bobSession, bob, JSON.stringify(sample(bobSession))]);
    await asRole("authenticated", alice, async () => {
      const { rows } = await db.query<{ id: string }>("select id from public.learning_sessions");
      expect(rows).toMatchObject([{ id: aliceSession }]);
    });
  });
});
