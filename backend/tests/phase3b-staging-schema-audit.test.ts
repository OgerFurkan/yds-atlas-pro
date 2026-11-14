import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// PHASE 3B v1.3 -- isolated, local-only characterization of the UNAPPLIED Phase 3A SQL draft.
// This file intentionally proves TWO KNOWN GAPS; it is NOT a security approval or migration.
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const aliceWord = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bobWord = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const emptyPlan = {
  groupSize: 20,
  assignments: [] as { day: number; words: string[] }[],
  excludedWordIds: [] as string[],
};

async function asAccount<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  try {
    return await work();
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  // Same reduced auth fixtures used by backend/tests/database.test.ts.
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; " +
      "create schema auth; create table auth.users(id uuid primary key); " +
      "create function auth.uid() returns uuid language sql stable as $$ " +
      "select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; " +
      "grant usage on schema auth to authenticated,anon,service_role;",
  );
  const baseline = await Bun.file(
    new URL("../../supabase/migrations/20261110161008_atlas_cloud_foundation.sql", import.meta.url),
  ).text();
  await db.exec(baseline.replace(/^\uFEFF/, ""));
  const draft = await Bun.file(
    new URL("../../supabase/sql/learning_foundation_draft.sql", import.meta.url),
  ).text();
  await db.exec(draft.replace(/^\uFEFF/, ""));
}, 60_000);

beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade;");
  await db.query("insert into auth.users(id) values($1),($2)", [alice, bob]);
  await db.query(
    "insert into public.words(id,user_id,word) values ($1,$2,'Evidence'),($3,$4,'Benefit')",
    [aliceWord, alice, bobWord, bob],
  );
});

afterAll(async () => {
  await db.close();
});

describe("Phase 3B v1.3 local-only SQL draft audit (NOT staging approval)", () => {
  test("the draft adds exactly two tables; all nine public tables have RLS enabled", async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c " +
        "join pg_namespace n on n.oid=c.relnamespace " +
        "where n.nspname='public' and c.relkind='r' order by c.relname",
    );
    expect(rows.rows).toHaveLength(9);
    expect(rows.rows.every((row) => row.relrowsecurity)).toBe(true);
    expect(rows.rows.map((row) => row.relname)).toContain("daily_plan_states");
    expect(rows.rows.map((row) => row.relname)).toContain("word_review_schedules");
  });

  test("anon cannot select either newly proposed table", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from public.daily_plan_states")).rejects.toThrow();
      await expect(db.query("select * from public.word_review_schedules")).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  });

  test("daily-plan RLS reads only the current owner's row", async () => {
    await db.query(
      "insert into public.daily_plan_states(user_id,payload) " +
        "values ($1,$3::jsonb),($2,$3::jsonb)",
      [alice, bob, JSON.stringify(emptyPlan)],
    );
    await asAccount(alice, async () => {
      const visible = await db.query<{ user_id: string }>(
        "select user_id from public.daily_plan_states",
      );
      expect(visible.rows.map((row) => row.user_id)).toEqual([alice]);
      const other = await db.query(
        "update public.daily_plan_states set revision = 7 " +
          "where user_id = $1 returning user_id",
        [bob],
      );
      expect(other.rows).toHaveLength(0);
    });
  });

  test("review schedules enforce a same-owner composite word foreign key", async () => {
    await asAccount(alice, async () => {
      await expect(
        db.query(
          "insert into public.word_review_schedules(user_id,word_id) values($1,$2)",
          [alice, bobWord],
        ),
      ).rejects.toThrow();
      await db.query(
        "insert into public.word_review_schedules(user_id,word_id) values($1,$2)",
        [alice, aliceWord],
      );
    });
    await asAccount(bob, async () => {
      const visible = await db.query("select * from public.word_review_schedules");
      expect(visible.rows).toHaveLength(0);
    });
  });

  test("review schedules reject negative repetition counters and out-of-range easing", async () => {
    await asAccount(alice, async () => {
      await expect(
        db.query(
          "insert into public.word_review_schedules(user_id,word_id,repetitions) " +
            "values($1,$2,-1)",
          [alice, aliceWord],
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          "insert into public.word_review_schedules(user_id,word_id,ease_factor) " +
            "values($1,$2,4.5)",
          [alice, aliceWord],
        ),
      ).rejects.toThrow();
    });
  });

  test("deleting a word also removes its review schedule", async () => {
    await asAccount(alice, async () => {
      await db.query(
        "insert into public.word_review_schedules(user_id,word_id) values($1,$2)",
        [alice, aliceWord],
      );
      await db.query("delete from public.words where id=$1", [aliceWord]);
      const result = await db.query("select * from public.word_review_schedules");
      expect(result.rows).toHaveLength(0);
    });
  });

  // GAP DEMONSTRATIONS: These tests characterize INSECURE draft behavior and
  // must be REPLACED with denial tests before approving any official migration.
  test("KNOWN GAP: authenticated direct UPDATE bypasses backend revision checks", async () => {
    await db.query(
      "insert into public.daily_plan_states(user_id,payload,revision) values($1,$2::jsonb,1)",
      [alice, JSON.stringify(emptyPlan)],
    );
    await asAccount(alice, async () => {
      const changed = await db.query<{ revision: number }>(
        "update public.daily_plan_states set revision=999 where user_id=$1 " +
          "returning revision",
        [alice],
      );
      expect(changed.rows[0]?.revision).toBe(999); // Evidence of a risk, NOT an acceptance criterion.
    });
  });

  test("KNOWN GAP: direct plan INSERT can include a different account's word ID", async () => {
    const foreignWordPlan = {
      groupSize: 20,
      assignments: [{ day: 1, words: [bobWord] }],
      excludedWordIds: [],
    };
    await asAccount(alice, async () => {
      await db.query(
        "insert into public.daily_plan_states(user_id,payload) values($1,$2::jsonb)",
        [alice, JSON.stringify(foreignWordPlan)],
      );
      const stored = await db.query<{ payload: typeof foreignWordPlan }>(
        "select payload from public.daily_plan_states where user_id=$1",
        [alice],
      );
      expect(stored.rows[0]?.payload.assignments[0]?.words).toEqual([bobWord]);
    });
  });
});
