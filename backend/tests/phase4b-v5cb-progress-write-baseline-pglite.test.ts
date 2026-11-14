import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * PHASE 4B v5C-B: CHARACTERIZATION ONLY, ISOLATED PGLITE.
 * These tests intentionally document insecure pre-cutover capabilities.
 * They are NOT regression requirements for the desired final security model.
 * Update/rewrite them during the coordinated v5C cutover; never ship a
 * production privilege change just to make this baseline pass.
 */
const db = new PGlite();
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const OWN_WORD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN_WORD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FORGED_WORD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function asUser<T>(userId: string, action: () => Promise<T>): Promise<T> {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  try {
    return await action();
  } finally {
    await db.exec("reset role");
  }
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
}, 60_000);

beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade;");
  await db.query("insert into auth.users(id) values($1),($2)", [ALICE, BOB]);
  await db.query("insert into public.profiles(user_id,daily_goal) values($1,20),($2,20)", [ALICE, BOB]);
  await db.query(
    "insert into public.words(id,user_id,word,score,content) values" +
    "($1,$2,'Evidence',0,'{}'::jsonb),($3,$4,'Other',0,'{}'::jsonb)",
    [OWN_WORD, ALICE, FOREIGN_WORD, BOB],
  );
});

afterAll(async () => { await db.close(); });

describe("v5C-B PRE-CUTOVER progress-write exposure baseline — PGlite ONLY", () => {
  test("authenticated currently has own-row score DML and client-callable score RPC", async () => {
    const { rows } = await db.query<{
      updateWords: boolean; insertWords: boolean; insertDay: boolean;
      insertGoal: boolean; scoreRpc: boolean;
    }>(`select
      has_table_privilege('authenticated','public.words','UPDATE') as "updateWords",
      has_table_privilege('authenticated','public.words','INSERT') as "insertWords",
      has_table_privilege('authenticated','public.daily_word_completions','INSERT') as "insertDay",
      has_table_privilege('authenticated','public.completed_goal_days','INSERT') as "insertGoal",
      has_function_privilege('authenticated','public.apply_word_scores(jsonb)','EXECUTE') as "scoreRpc"`);
    expect(rows[0]).toEqual({
      updateWords: true, insertWords: true, insertDay: true, insertGoal: true, scoreRpc: true,
    });
  });

  test("an owner JWT can arbitrarily update its own word score without completing a game", async () => {
    const rows = await asUser(ALICE, async () => {
      const result = await db.query<{ score: number }>(
        "update public.words set score=100 where id=$1 returning score", [OWN_WORD],
      );
      return result.rows;
    });
    expect(rows).toEqual([{ score: 100 }]);
    const { rows: results } = await db.query("select * from public.learning_results");
    expect(results).toHaveLength(0);
  });

  test("an owner JWT can insert a new word with a forged initial score", async () => {
    await asUser(ALICE, async () => {
      const { rows } = await db.query<{ score: number }>(
        "insert into public.words(user_id,word,score) values($1,'Forged mastery',100) returning score",
        [ALICE],
      );
      expect(rows[0]?.score).toBe(100);
    });
    expect((await db.query("select * from public.learning_results")).rows).toHaveLength(0);
  });

  test("import_words RPC accepts an arbitrary initial score from a client", async () => {
    await asUser(ALICE, async () => {
      const result = await db.query<{ value: { added: number; duplicates: number } }>(
        "select public.import_words($1::jsonb) as value",
        [JSON.stringify([{ word: "Imported score", score: 100 }])],
      );
      expect(result.rows[0]?.value.added).toBe(1);
    });
    const { rows } = await db.query<{ score: number }>(
      "select score from public.words where user_id=$1 and word='Imported score'", [ALICE],
    );
    expect(rows[0]?.score).toBe(100);
  });

  test("apply_word_scores RPC can set mastery without a completed session", async () => {
    await asUser(ALICE, async () => {
      await db.query("select public.apply_word_scores($1::jsonb)", [
        JSON.stringify([{ id: OWN_WORD, score: 99 }]),
      ]);
    });
    const { rows } = await db.query<{ score: number }>(
      "select score from public.words where id=$1", [OWN_WORD],
    );
    expect(rows[0]?.score).toBe(99);
    expect((await db.query("select * from public.learning_results")).rows).toHaveLength(0);
  });

  test("daily_word_completions permits a fabricated word ID with no completed game", async () => {
    await asUser(ALICE, async () => {
      await db.query(
        "insert into public.daily_word_completions(user_id,day,word_id) " +
        "values($1,(now() at time zone 'Europe/Istanbul')::date,$2)",
        [ALICE, FORGED_WORD],
      );
    });
    const { rows } = await db.query<{ word_id: string }>(
      "select word_id from public.daily_word_completions where user_id=$1", [ALICE],
    );
    expect(rows).toEqual([{ word_id: FORGED_WORD }]);
    expect((await db.query("select * from public.learning_results")).rows).toHaveLength(0);
  });

  test("completed_goal_days permits a forged milestone without any completed game", async () => {
    await asUser(ALICE, async () => {
      await db.query(
        "insert into public.completed_goal_days(user_id,day,goal) " +
        "values($1,(now() at time zone 'Europe/Istanbul')::date,20)",
        [ALICE],
      );
    });
    expect((await db.query("select * from public.completed_goal_days")).rows).toHaveLength(1);
    expect((await db.query("select * from public.daily_word_completions")).rows).toHaveLength(0);
  });

  test("set_daily_goal can record a milestone from already fabricated day completions", async () => {
    await asUser(ALICE, async () => {
      await db.query(
        "insert into public.daily_word_completions(user_id,day,word_id) " +
        "select $1,(now() at time zone 'Europe/Istanbul')::date,gen_random_uuid() " +
        "from generate_series(1,10)",
        [ALICE],
      );
      await db.query("select public.set_daily_goal(10)");
    });
    const { rows } = await db.query<{ goal: number }>(
      "select goal from public.completed_goal_days where user_id=$1", [ALICE],
    );
    expect(rows).toEqual([{ goal: 10 }]);
    expect((await db.query("select * from public.learning_results")).rows).toHaveLength(0);
  });

  test("RLS still prevents a different owner from changing Alice's score or claiming her milestone", async () => {
    await asUser(BOB, async () => {
      const { rows } = await db.query(
        "update public.words set score=100 where id=$1 returning id", [OWN_WORD],
      );
      expect(rows).toHaveLength(0);
      await expect(db.query(
        "insert into public.completed_goal_days(user_id,day,goal) values($1,current_date,20)",
        [ALICE],
      )).rejects.toThrow();
    });
    const { rows } = await db.query<{ score: number }>(
      "select score from public.words where id=$1", [OWN_WORD],
    );
    expect(rows[0]?.score).toBe(0);
  });
});
