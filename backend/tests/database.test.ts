import { beforeAll, beforeEach, afterAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const wordId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to authenticated,anon,service_role;",
  );
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  // Apply every migration in timestamp order so the test database matches production.
  for (const name of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    const migration = await Bun.file(new URL(name, migrations)).text();
    await db.exec(migration.replace(/^\uFEFF/, ""));
  }
}, 60_000);
beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade;");
  await db.query("insert into auth.users(id) values($1),($2)", [alice, bob]);
  await db.query("insert into public.profiles(user_id,daily_goal) values($1,10),($2,20)", [
    alice,
    bob,
  ]);
  await db.query("insert into public.words(id,user_id,word,content) values($1,$2,'Expand','{}')", [
    wordId,
    alice,
  ]);
});
afterAll(async () => {
  await db.close();
});
async function asUser<T>(id: string, work: () => Promise<T>) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try {
    return await work();
  } finally {
    await db.exec("reset role");
  }
}
describe("Postgres ownership, atomicity and quotas", () => {
  test("bulk score writes remain owned and reject duplicate score IDs atomically", async () => {
    await asUser(bob, async () => {
      await db.query("select public.apply_word_scores($1)", [
        JSON.stringify([{ id: wordId, score: 100 }]),
      ]);
    });
    expect(
      (await db.query<{ score: number }>("select score from public.words where id=$1", [wordId]))
        .rows[0].score,
    ).toBe(0);
    await asUser(alice, async () => {
      await expect(
        db.query("select public.apply_word_scores($1)", [
          JSON.stringify([
            { id: wordId, score: 20 },
            { id: wordId, score: 80 },
          ]),
        ]),
      ).rejects.toThrow();
      await db.query("select public.apply_word_scores($1)", [
        JSON.stringify([{ id: wordId, score: 88 }]),
      ]);
      expect(
        (await db.query<{ score: number }>("select score from public.words where id=$1", [wordId]))
          .rows[0].score,
      ).toBe(88);
    });
  });
  test("lowering today's goal records a lasting milestone and never changes another account", async () => {
    await db.query(
      "insert into public.daily_word_completions(user_id,day,word_id) select $1, (now() at time zone 'Europe/Istanbul')::date, gen_random_uuid() from generate_series(1,10)",
      [alice],
    );
    await asUser(alice, async () => {
      await db.query("select public.set_daily_goal(10)");
      expect((await db.query("select * from public.completed_goal_days")).rows).toHaveLength(1);
      await db.query("select public.set_daily_goal(30)");
      expect((await db.query("select * from public.completed_goal_days")).rows).toHaveLength(1);
      await expect(db.query("select public.set_daily_goal(15)")).rejects.toThrow();
    });
    await asUser(bob, async () => {
      expect(
        (await db.query<{ daily_goal: number }>("select daily_goal from public.profiles")).rows[0]
          .daily_goal,
      ).toBe(20);
      expect((await db.query("select * from public.completed_goal_days")).rows).toHaveLength(0);
    });
  });
  test("all application tables have RLS, and no SECURITY DEFINER function is exposed", async () => {
    const result = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'",
    );
    expect(result.rows).toHaveLength(7);
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
    const functions = await db.query(
      "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and prosecdef",
    );
    expect(functions.rows).toHaveLength(0);
  });
  test("anonymous callers cannot read tables or execute app functions", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from public.words")).rejects.toThrow();
      await expect(db.query("select public.import_words('[]')")).rejects.toThrow();
      await expect(db.query("select public.consume_ai_quota($1)", [alice])).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  });
  test("another user's words cannot be selected, updated, deleted or reassigned", async () => {
    await asUser(bob, async () => {
      expect((await db.query("select * from public.words")).rows).toHaveLength(0);
      expect(
        (await db.query("update public.words set score=100 where id=$1 returning id", [wordId]))
          .rows,
      ).toHaveLength(0);
      expect(
        (await db.query("delete from public.words where id=$1 returning id", [wordId])).rows,
      ).toHaveLength(0);
      await expect(
        db.query("insert into public.words(user_id,word) values($1,'Steal')", [alice]),
      ).rejects.toThrow();
    });
    await asUser(alice, async () => {
      await expect(
        db.query("update public.words set user_id=$1 where id=$2", [bob, wordId]),
      ).rejects.toThrow();
      expect(
        (await db.query<{ score: number }>("select score from public.words where id=$1", [wordId]))
          .rows[0].score,
      ).toBe(0);
    });
  });
  test("bulk import is deduplicated by owner and rolls back entirely on invalid input", async () => {
    await asUser(alice, async () => {
      const result = await db.query<{ value: { added: number; duplicates: number } }>(
        "select public.import_words($1) as value",
        [JSON.stringify([{ word: " EXPAND " }, { word: "Benefit", meanings: ["Fayda"] }])],
      );
      expect(result.rows[0].value).toEqual({ added: 1, duplicates: 1 });
      await expect(
        db.query("select public.import_words($1)", [
          JSON.stringify([{ word: "New entry" }, { word: "" }]),
        ]),
      ).rejects.toThrow();
      expect(
        (await db.query("select * from public.words where word='New entry'")).rows,
      ).toHaveLength(0);
    });
    await asUser(bob, async () => {
      expect(
        (
          await db.query("select public.import_words($1) as value", [
            JSON.stringify([{ word: "Expand" }]),
          ])
        ).rows[0],
      ).toEqual({ value: { added: 1, duplicates: 0 } });
    });
  });
  test("session revision checks reject stale writers and prevent cross-account overwrite", async () => {
    const snapshot = JSON.stringify({ id: taskId, tutorial: false, phase: "meaning" });
    await asUser(alice, async () => {
      expect(
        (
          await db.query("select public.save_learning_session($1,$2,0) as revision", [
            taskId,
            snapshot,
          ])
        ).rows[0],
      ).toEqual({ revision: 1 });
      await expect(
        db.query("select public.save_learning_session($1,$2,0)", [taskId, snapshot]),
      ).rejects.toThrow();
      expect(
        (
          await db.query("select public.save_learning_session($1,$2,1) as revision", [
            taskId,
            snapshot,
          ])
        ).rows[0],
      ).toEqual({ revision: 2 });
      await expect(
        db.query("select public.save_learning_session($1,$2,1)", [taskId, snapshot]),
      ).rejects.toThrow();
    });
    await asUser(bob, async () => {
      await expect(
        db.query("select public.save_learning_session($1,$2,2)", [taskId, snapshot]),
      ).rejects.toThrow();
    });
  });
  test("completion commits once, filters foreign words, and repeated requests cannot change scores", async () => {
    const foreign = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.query("insert into public.words(id,user_id,word) values($1,$2,'Private')", [
      foreign,
      bob,
    ]);
    const snapshot = JSON.stringify({
      id: taskId,
      tutorial: false,
      phase: "complete",
      saved: false,
    });
    await asUser(alice, async () => {
      await db.query("select public.save_learning_session($1,$2,0)", [taskId, snapshot]);
      await db.query("select public.complete_learning_session($1,$2)", [
        taskId,
        JSON.stringify([
          { id: wordId, score: 88 },
          { id: foreign, score: 100 },
        ]),
      ]);
      await db.query("select public.complete_learning_session($1,$2)", [
        taskId,
        JSON.stringify([{ id: wordId, score: 5 }]),
      ]);
      expect(
        (await db.query<{ score: number }>("select score from public.words where id=$1", [wordId]))
          .rows[0].score,
      ).toBe(88);
      expect((await db.query("select * from public.learning_results")).rows).toHaveLength(1);
      expect((await db.query("select * from public.daily_word_completions")).rows).toHaveLength(1);
    });
    expect(
      (await db.query<{ score: number }>("select score from public.words where id=$1", [foreign]))
        .rows[0].score,
    ).toBe(0);
  });
  test("invalid completion rolls back and an unfinished session cannot be finalized", async () => {
    await asUser(alice, async () => {
      await db.query("select public.save_learning_session($1,$2,0)", [
        taskId,
        JSON.stringify({ id: taskId, tutorial: false, phase: "meaning" }),
      ]);
      await expect(
        db.query("select public.complete_learning_session($1,$2)", [
          taskId,
          JSON.stringify([{ id: wordId, score: 90 }]),
        ]),
      ).rejects.toThrow();
      await db.query("select public.save_learning_session($1,$2,1)", [
        taskId,
        JSON.stringify({ id: taskId, tutorial: false, phase: "complete" }),
      ]);
      await expect(
        db.query("select public.complete_learning_session($1,$2)", [
          taskId,
          JSON.stringify([{ id: wordId, score: 999 }]),
        ]),
      ).rejects.toThrow();
      expect((await db.query("select * from public.learning_results")).rows).toHaveLength(0);
      expect(
        (await db.query<{ score: number }>("select score from public.words where id=$1", [wordId]))
          .rows[0].score,
      ).toBe(0);
    });
  });
  test("AI quotas are server-only, atomic, bounded and isolated by account", async () => {
    await asUser(alice, async () => {
      await expect(db.query("select public.consume_ai_quota($1)", [alice])).rejects.toThrow();
      await expect(db.query("select * from public.ai_usage")).rejects.toThrow();
    });
    await db.exec("set role service_role");
    try {
      for (let i = 0; i < 15; i++)
        expect(
          (
            await db.query<{ allowed: boolean }>("select public.consume_ai_quota($1) as allowed", [
              alice,
            ])
          ).rows[0].allowed,
        ).toBe(true);
      expect(
        (
          await db.query<{ allowed: boolean }>("select public.consume_ai_quota($1) as allowed", [
            alice,
          ])
        ).rows[0].allowed,
      ).toBe(false);
      expect(
        (
          await db.query<{ allowed: boolean }>("select public.consume_ai_quota($1) as allowed", [
            bob,
          ])
        ).rows[0].allowed,
      ).toBe(true);
    } finally {
      await db.exec("reset role");
    }
  });
});
