import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/** A cutover authorization test, not an independent-connection concurrency test. */
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const word = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sessionB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sessionC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const scores = [{ id: word, score: 88 }];
const ratings = [{ id: word, rating: "good" }];
let originalLegacyExecutable = false;
let originalResultInsertable = false;

async function asRole<T>(role: "authenticated" | "anon" | "service_role", action: () => Promise<T>) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [role === "anon" ? "" : alice]);
  try { return await action(); }
  finally { await db.exec("reset role"); }
}

async function rights() {
  const rights = await db.query<{
    legacy: boolean; v3Auth: boolean; v3Service: boolean;
    resultsInsert: boolean; resultsSelect: boolean;
  }>(`select
    has_function_privilege('authenticated','public.complete_learning_session(uuid,jsonb)','EXECUTE') as legacy,
    has_function_privilege('authenticated','public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)','EXECUTE') as "v3Auth",
    has_function_privilege('service_role','public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)','EXECUTE') as "v3Service",
    has_table_privilege('authenticated','public.learning_results','INSERT') as "resultsInsert",
    has_table_privilege('authenticated','public.learning_results','SELECT') as "resultsSelect"`);
  return rights.rows[0];
}

beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; " +
    "create schema auth; create table auth.users(id uuid primary key); " +
    "create function auth.uid() returns uuid language sql stable as $$ " +
    "select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; " +
    "grant usage on schema auth to authenticated,anon,service_role;",
  );
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    await db.exec((await Bun.file(new URL(name, migrations)).text()).replace(/^\uFEFF/, ""));
  }
  // PGlite-created service_role lacks managed Supabase table grants.
  await db.exec(`grant usage on schema public to service_role;
    grant all privileges on table public.learning_results,public.learning_sessions,
      public.words,public.word_review_schedules,public.daily_word_completions,
      public.completed_goal_days,public.profiles to service_role;`);
  const v3 = await Bun.file(new URL("../../docs/architecture/phase4b-v3-atomic-completion-DRAFT.sql", import.meta.url)).text();
  await db.exec(v3.replace(/^\uFEFF/, ""));
  await db.query("insert into auth.users(id) values ($1)", [alice]);
  await db.query("insert into public.profiles(user_id,daily_goal) values($1,20)", [alice]);
  await db.query("insert into public.words(id,user_id,word) values($1,$2,'Evidence')", [word, alice]);
  const snapshot = {
    id: sessionA, version: 3, phase: "complete", saved: false, tutorial: false,
    queue: [], words: [{ id: word, score: 20 }], scoreChanges: {},
    assessment: { [word]: { matchingDone: true, matchingErrors: 0,
      meaning: { correct: true, confidence: 0 }, context: { correct: true, confidence: 0 } } },
  };
  await db.query("insert into public.learning_sessions(id,user_id,snapshot,revision) values($1,$2,$3::jsonb,1)",
    [sessionA, alice, JSON.stringify(snapshot)]);
  await db.query("insert into public.learning_sessions(id,user_id,snapshot,revision) values($1,$2,$3::jsonb,1)",
    [sessionB, alice, JSON.stringify({ ...snapshot, id: sessionB })]);

  const before = await rights();
  originalLegacyExecutable = before?.legacy === true;
  originalResultInsertable = before?.resultsInsert === true;

  // Demonstrate that the previous owner-only RLS policy really permits direct
  // completion-ledger insertion. This happens in the disposable PGlite only.
  await asRole("authenticated", async () => {
    await db.query("insert into public.learning_results(session_id,user_id,scores) values($1,$2,$3::jsonb)",
      [sessionB, alice, JSON.stringify(scores)]);
  });
  await db.query("delete from public.learning_results where session_id=$1", [sessionB]);

  const cutover = await Bun.file(new URL("../../docs/architecture/phase4b-v4-legacy-cutover-REVIEW-ONLY.sql", import.meta.url)).text();
  await db.exec(cutover.replace(/^\uFEFF/, ""));
}, 60_000);

afterAll(async () => { await db.close(); });

describe("Phase 4B v4 legacy completion cutover (isolated PGlite ONLY)", () => {
  test("pre-cutover privilege exposure is demonstrated, not merely assumed", () => {
    expect(originalLegacyExecutable).toBe(true);
    expect(originalResultInsertable).toBe(true);
  });

  test("cutover revokes legacy RPC and direct ledger INSERT without revoking owner reads", async () => {
    const after = await rights();
    expect(after).toMatchObject({
      legacy: false, v3Auth: false, v3Service: true,
      resultsInsert: false, resultsSelect: true,
    });
  });

  test("authenticated and anonymous clients cannot invoke the old completion RPC", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      await asRole(role, async () => {
        await expect(db.query("select public.complete_learning_session($1::uuid,$2::jsonb)",
          [sessionB, JSON.stringify(scores)])).rejects.toThrow();
      });
    }
  });

  test("authenticated cannot forge a completion ledger record after cutover", async () => {
    await asRole("authenticated", async () => {
      await expect(db.query("insert into public.learning_results(session_id,user_id,scores) values($1,$2,$3::jsonb)",
        [sessionB, alice, JSON.stringify(scores)])).rejects.toThrow();
      expect((await db.query("select * from public.learning_results")).rows).toHaveLength(0);
    });
  });

  test("service-only v3 completion still atomically writes score, review, and ledger", async () => {
    const result = await asRole("service_role", () => db.query<{ value: typeof scores }>(
      "select public.complete_learning_session_v3($1::uuid,$2::uuid,$3::integer,$4::jsonb,$5::jsonb) as value",
      [alice, sessionA, 1, JSON.stringify(scores), JSON.stringify(ratings)],
    ));
    expect(result.rows[0]?.value).toEqual(scores);
    const schedule = await db.query<{ interval_days: number }>(
      "select interval_days from public.word_review_schedules where user_id=$1 and word_id=$2", [alice, word]);
    expect(schedule.rows[0]?.interval_days).toBe(1);
    const recorded = await db.query("select * from public.learning_results where session_id=$1", [sessionA]);
    expect(recorded.rows).toHaveLength(1);
  });

  test("authenticated user can still save an unfinished session through the existing RPC", async () => {
    await asRole("authenticated", async () => {
      const value = await db.query<{ revision: number }>(
        "select public.save_learning_session($1::uuid,$2::jsonb,0) as revision",
        [sessionC, JSON.stringify({ id: sessionC, tutorial: false, phase: "meaning" })],
      );
      expect(value.rows[0]?.revision).toBe(1);
    });
  });
});
