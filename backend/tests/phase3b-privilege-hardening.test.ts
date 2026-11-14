import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Isolated security acceptance tests for an UNAPPLIED hardening SQL candidate.
// Previous v1.3 characterization tests intentionally run the *insecure* draft;
// these tests instead apply the protective overlay and assert the gaps are closed.
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const aliceWord = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bobWord = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ownPlan = {
  groupSize: 20,
  assignments: [{ day: 1, words: [aliceWord] }],
  excludedWordIds: [] as string[],
};

async function withRole<T>(role: "authenticated" | "service_role" | "anon", user: string | null, action: () => Promise<T>) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
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
      "grant usage on schema auth to authenticated, anon, service_role;",
  );
  for (const path of [
    "../../supabase/migrations/20261110161008_atlas_cloud_foundation.sql",
    "../../supabase/sql/learning_foundation_draft.sql",
    "../../supabase/sql/learning_foundation_hardening_v1.4.sql",
  ]) {
    const sql = await Bun.file(new URL(path, import.meta.url)).text();
    await db.exec(sql.replace(/^\uFEFF/, ""));
  }
}, 60_000);

beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade;");
  await db.query("insert into auth.users(id) values($1),($2)", [alice, bob]);
  await db.query(
    "insert into public.words(id,user_id,word) values($1,$2,'Evidence'),($3,$4,'Benefit')",
    [aliceWord, alice, bobWord, bob],
  );
});

afterAll(async () => { await db.close(); });

describe("Phase 3B v1.4 local-only hardening candidate (NOT DEPLOYED)", () => {
  test("RLS stays on both tables, and only owner SELECT is available to signed-in accounts", async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace " +
        "where n.nspname='public' and c.relname in ('daily_plan_states','word_review_schedules') order by c.relname",
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every(({ relrowsecurity }) => relrowsecurity)).toBe(true);
    await withRole("authenticated", alice, async () => {
      expect((await db.query("select * from public.daily_plan_states")).rows).toEqual([]);
      expect((await db.query("select * from public.word_review_schedules")).rows).toEqual([]);
    });
    await withRole("anon", null, async () => {
      await expect(db.query("select * from public.daily_plan_states")).rejects.toThrow();
      await expect(db.query("select * from public.word_review_schedules")).rejects.toThrow();
    });
  });

  test("authenticated users cannot directly INSERT, UPDATE or DELETE plans", async () => {
    await withRole("service_role", null, async () => {
      await db.query(
        "insert into public.daily_plan_states(user_id,payload) values($1,$2::jsonb)",
        [alice, JSON.stringify(ownPlan)],
      );
    });
    await withRole("authenticated", alice, async () => {
      await expect(db.query(
        "insert into public.daily_plan_states(user_id,payload) values($1,$2::jsonb)",
        [alice, JSON.stringify(ownPlan)],
      )).rejects.toThrow();
      await expect(db.query("update public.daily_plan_states set revision=999 where user_id=$1", [alice])).rejects.toThrow();
      await expect(db.query("delete from public.daily_plan_states where user_id=$1", [alice])).rejects.toThrow();
      expect((await db.query("select revision from public.daily_plan_states")).rows).toEqual([{ revision: 1 }]);
    });
  });

  test("authenticated users cannot directly write review schedules", async () => {
    await withRole("authenticated", alice, async () => {
      await expect(db.query(
        "insert into public.word_review_schedules(user_id,word_id) values($1,$2)",
        [alice, aliceWord],
      )).rejects.toThrow();
    });
    await withRole("service_role", null, async () => {
      await db.query(
        "insert into public.word_review_schedules(user_id,word_id) values($1,$2)",
        [alice, aliceWord],
      );
    });
    await withRole("authenticated", alice, async () => {
      expect((await db.query("select word_id from public.word_review_schedules")).rows).toEqual([{ word_id: aliceWord }]);
      await expect(db.query("update public.word_review_schedules set repetitions=100")).rejects.toThrow();
      await expect(db.query("delete from public.word_review_schedules")).rejects.toThrow();
    });
  });

  test("server-only plan insert requires the owner's own word IDs", async () => {
    const foreign = { ...ownPlan, assignments: [{ day: 1, words: [bobWord] }] };
    await withRole("service_role", null, async () => {
      await expect(db.query(
        "insert into public.daily_plan_states(user_id,payload) values($1,$2::jsonb)",
        [alice, JSON.stringify(foreign)],
      )).rejects.toThrow();
      await db.query(
        "insert into public.daily_plan_states(user_id,payload) values($1,$2::jsonb)",
        [alice, JSON.stringify(ownPlan)],
      );
    });
    await withRole("authenticated", bob, async () => {
      expect((await db.query("select * from public.daily_plan_states")).rows).toHaveLength(0);
    });
  });

  test("invalid, duplicated, excluded or out-of-range group data fails closed", async () => {
    const invalidPlans = [
      { ...ownPlan, assignments: [{ day: 1, words: [aliceWord, aliceWord] }] },
      { ...ownPlan, excludedWordIds: [aliceWord] },
      { ...ownPlan, assignments: [{ day: 61, words: [aliceWord] }] },
      { ...ownPlan, groupSize: 19 },
      { ...ownPlan, assignments: "not-an-array" },
      { ...ownPlan, assignments: [{ day: 1, words: ["not-a-uuid"] }] },
    ];
    await withRole("service_role", null, async () => {
      for (const invalid of invalidPlans) {
        await expect(db.query(
          "insert into public.daily_plan_states(user_id,payload) values($1,$2::jsonb)",
          [alice, JSON.stringify(invalid)],
        )).rejects.toThrow();
      }
    });
    const stored = await db.query("select * from public.daily_plan_states");
    expect(stored.rows).toHaveLength(0);
  });

  test("even a privileged writer cannot change owner or skip/reuse revisions", async () => {
    await withRole("service_role", null, async () => {
      await db.query(
        "insert into public.daily_plan_states(user_id,payload,revision) values($1,$2::jsonb,1)",
        [alice, JSON.stringify(ownPlan)],
      );
      await expect(db.query(
        "update public.daily_plan_states set revision=999 where user_id=$1", [alice],
      )).rejects.toThrow();
      await expect(db.query(
        "update public.daily_plan_states set user_id=$2,revision=2 where user_id=$1", [alice, bob],
      )).rejects.toThrow();
      const updated = await db.query<{ revision: number }>(
        "update public.daily_plan_states set revision=2,payload=$2::jsonb where user_id=$1 and revision=1 returning revision",
        [alice, JSON.stringify(ownPlan)],
      );
      expect(updated.rows[0]?.revision).toBe(2);
      const stale = await db.query<{ revision: number }>(
        "update public.daily_plan_states set revision=3 where user_id=$1 and revision=1 returning revision",
        [alice],
      );
      expect(stale.rows).toHaveLength(0);
    });
  });
});
