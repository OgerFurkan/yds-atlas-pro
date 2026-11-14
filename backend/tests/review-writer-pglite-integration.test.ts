import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/** Real PostgreSQL execution in isolated in-memory PGlite. No Supabase connection. */
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const word = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreignWord = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sessionA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sessionB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function snapshot(id: string, rating: "easy" | "good" | "again", version: 2 | 3 = 3) {
  const correct = rating !== "again";
  const confidence = rating === "easy" ? 20 : rating === "good" ? 0 : null;
  return {
    id,
    version,
    tutorial: false,
    phase: "complete",
    saved: false,
    queue: [],
    words: [{ id: word, score: 20 }],
    scoreChanges: { [word]: 20 },
    assessment: {
      [word]: {
        matchingDone: true,
        matchingErrors: rating === "again" ? 2 : 0,
        meaning: { correct, confidence },
        context: { correct, confidence },
      },
    },
  };
}
function payload(rating: "easy" | "good" | "again") {
  return {
    scores: [{ id: word, score: rating === "easy" ? 100 : rating === "good" ? 88 : 0 }],
    ratings: [{ id: word, rating }],
  };
}
async function asRole<T>(role: "service_role" | "authenticated" | "anon", fn: () => Promise<T>) {
  await db.exec(`set role ${role}`);
  try { return await fn(); }
  finally { await db.exec("reset role"); }
}
async function createSession(id: string, snap: unknown, userId = alice, updatedAt?: string) {
  await db.query(
    "insert into public.learning_sessions(id,user_id,snapshot,revision,updated_at) values ($1,$2,$3::jsonb,1,coalesce($4::timestamptz,now()))",
    [id, userId, JSON.stringify(snap), updatedAt ?? null],
  );
}
async function complete(id: string, data: { scores: unknown; ratings: unknown }, ownerId = alice, revision = 1) {
  return await db.query<{ value: { id: string; score: number }[] }>(
    "select public.complete_learning_session_v3($1::uuid,$2::uuid,$3::integer,$4::jsonb,$5::jsonb) as value",
    [ownerId, id, revision, JSON.stringify(data.scores), JSON.stringify(data.ratings)],
  );
}
async function score() {
  const result = await db.query<{ score: number }>("select score from public.words where id=$1", [word]);
  return result.rows[0]?.score;
}
async function schedule() {
  const result = await db.query<{ repetitions: number; lapses: number; interval_days: number; ease_factor: string }>(
    "select repetitions,lapses,interval_days,ease_factor from public.word_review_schedules where user_id=$1 and word_id=$2",
    [alice, word],
  );
  return result.rows[0] ?? null;
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
  // The isolated PGlite role is not provisioned with Supabase's built-in
  // service_role table grants. Mirror the verified STAGING ACLs here only;
  // BYPASSRLS never substitutes for ordinary PostgreSQL table privileges.
  // This grants nothing to authenticated/anon and changes no deployment SQL.
  await db.exec(`
    grant usage on schema public to service_role;
    grant all privileges on table
      public.learning_results,
      public.learning_sessions,
      public.words,
      public.word_review_schedules,
      public.daily_word_completions,
      public.completed_goal_days,
      public.profiles
    to service_role;
  `);
  const candidate = await Bun.file(
    new URL("../../docs/architecture/phase4b-v3-atomic-completion-DRAFT.sql", import.meta.url),
  ).text();
  await db.exec(candidate.replace(/^\uFEFF/, ""));
}, 60_000);

beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade");
  await db.query("insert into auth.users(id) values($1),($2)", [alice, bob]);
  await db.query("insert into public.profiles(user_id,daily_goal) values($1,10),($2,20)", [alice, bob]);
  await db.query(
    "insert into public.words(id,user_id,word) values($1,$2,'Evidence'),($3,$4,'Private')",
    [word, alice, foreignWord, bob],
  );
});
afterAll(async () => { await db.close(); });

describe("Phase 4B v3 real SQL in isolated PGlite (NOT STAGING)", () => {
  test("only service_role can execute; authenticated and anon cannot call privileged RPC", async () => {
    await createSession(sessionA, snapshot(sessionA, "good"));
    await asRole("authenticated", async () => {
      await expect(complete(sessionA, payload("good"))).rejects.toThrow();
    });
    await asRole("anon", async () => {
      await expect(complete(sessionA, payload("good"))).rejects.toThrow();
    });
    expect(await score()).toBe(0);
  });

  test("successful completion atomically updates score, review schedule, result and progress", async () => {
    await createSession(sessionA, snapshot(sessionA, "good"));
    const result = await asRole("service_role", () => complete(sessionA, payload("good")));
    expect(result.rows[0]?.value).toEqual([{ id: word, score: 88 }]);
    expect(await score()).toBe(88);
    expect(await schedule()).toMatchObject({ repetitions: 1, lapses: 0, interval_days: 1 });
    expect((await db.query("select * from public.learning_results")).rows).toHaveLength(1);
    expect((await db.query("select * from public.daily_word_completions")).rows).toHaveLength(1);
    const session = await db.query<{ completed_at: string | null; revision: number; snapshot: { saved: boolean } }>(
      "select completed_at,revision,snapshot from public.learning_sessions where id=$1", [sessionA],
    );
    expect(session.rows[0]?.completed_at).not.toBeNull();
    expect(session.rows[0]?.revision).toBe(2);
    expect(session.rows[0]?.snapshot.saved).toBe(true);
  });

  test("replaying a completed session does not change scores, schedule or ledger", async () => {
    await createSession(sessionA, snapshot(sessionA, "good"));
    await asRole("service_role", () => complete(sessionA, payload("good")));
    const prior = await schedule();
    const replay = await asRole("service_role", () => complete(sessionA, payload("again"), alice, 1));
    expect(replay.rows[0]?.value).toEqual([{ id: word, score: 88 }]);
    expect(await score()).toBe(88);
    expect(await schedule()).toEqual(prior);
    expect((await db.query("select * from public.learning_results")).rows).toHaveLength(1);
  });

  test("mismatched rating or score rolls back all state", async () => {
    await createSession(sessionA, snapshot(sessionA, "good"));
    await asRole("service_role", async () => {
      await expect(complete(sessionA, payload("easy"))).rejects.toThrow();
      await expect(complete(sessionA, { ...payload("good"), scores: [{ id: word, score: 50 }] })).rejects.toThrow();
    });
    expect(await score()).toBe(0);
    expect(await schedule()).toBeNull();
    expect((await db.query("select * from public.learning_results")).rows).toHaveLength(0);
    expect((await db.query("select * from public.daily_word_completions")).rows).toHaveLength(0);
    const row = await db.query<{ completed_at: string | null }>(
      "select completed_at from public.learning_sessions where id=$1", [sessionA],
    );
    expect(row.rows[0]?.completed_at).toBeNull();
  });

  test("a late SRS constraint failure rolls back an earlier word score update and result insert", async () => {
    await createSession(sessionA, snapshot(sessionA, "again"));
    await db.query("update public.words set score=77 where id=$1", [word]);
    await db.query(
      "insert into public.word_review_schedules(user_id,word_id,lapses) values($1,$2,2147483647)",
      [alice, word],
    );
    await asRole("service_role", async () => {
      await expect(complete(sessionA, payload("again"))).rejects.toThrow();
    });
    expect(await score()).toBe(77);
    expect((await schedule())?.lapses).toBe(2147483647);
    expect((await db.query("select * from public.learning_results")).rows).toHaveLength(0);
    expect((await db.query("select * from public.daily_word_completions")).rows).toHaveLength(0);
    const row = await db.query<{ completed_at: string | null }>(
      "select completed_at from public.learning_sessions where id=$1", [sessionA],
    );
    expect(row.rows[0]?.completed_at).toBeNull();
  });

  test("wrong owner or missing owner word cannot update other account data", async () => {
    await createSession(sessionA, snapshot(sessionA, "easy"));
    await asRole("service_role", async () => {
      await expect(complete(sessionA, payload("easy"), bob)).rejects.toThrow();
      await expect(complete(sessionA, {
        scores: [{ id: foreignWord, score: 100 }],
        ratings: [{ id: foreignWord, rating: "easy" }],
      })).rejects.toThrow();
    });
    expect(await score()).toBe(0);
    const other = await db.query<{ score: number }>("select score from public.words where id=$1", [foreignWord]);
    expect(other.rows[0]?.score).toBe(0);
  });

  test("late older completion cannot downgrade a newer score OR schedule", async () => {
    await createSession(
      sessionA, snapshot(sessionA, "again"), alice,
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    );
    await createSession(sessionB, snapshot(sessionB, "easy"));
    await asRole("service_role", () => complete(sessionB, payload("easy")));
    expect(await score()).toBe(100);
    const newer = await schedule();
    expect(newer).toMatchObject({ repetitions: 1, interval_days: 3 });
    await asRole("service_role", () => complete(sessionA, payload("again")));
    expect(await score()).toBe(100);
    expect(await schedule()).toEqual(newer);
    expect((await db.query("select * from public.learning_results")).rows).toHaveLength(2);
  });

  test("legacy version-two games do not invent SRS schedule entries", async () => {
    await createSession(sessionA, snapshot(sessionA, "good", 2));
    await asRole("service_role", () => complete(sessionA, { scores: [{ id: word, score: 40 }], ratings: [] }));
    expect(await score()).toBe(40);
    expect(await schedule()).toBeNull();
  });
});
