import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const wordId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeAll(async () => {
  await db.exec(
    "create role authenticator; create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to authenticated,anon,service_role;",
  );
  const migrations = new URL("../../../supabase/migrations/", import.meta.url);
  // Apply every migration in timestamp order so the test database matches production.
  for (const name of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    if (name.endsWith("_account_data_foundation.sql")) {
      const fixture = new URL("./profile-privileges.fixture.sql", import.meta.url);
      await db.exec("begin");
      try {
        await db.exec(await Bun.file(fixture).text());
      } finally {
        await db.exec("rollback");
      }
    }
    const migration = await Bun.file(new URL(name, migrations)).text();
    await db.exec(migration.replace(/^\uFEFF/, ""));
  }
}, 60_000);
beforeEach(async () => {
  benchmarkVersions = undefined;
  await db.exec("reset role; truncate auth.users cascade;");
  await db.query("insert into auth.users(id) values($1),($2)", [alice, bob]);
  await db.query("insert into auth.sessions(id,user_id) values($1,$1),($2,$2)", [alice, bob]);
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
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [
      id,
      JSON.stringify({
        sub: id,
        session_id: id,
        amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
      }),
    ],
  );
  try {
    return await work();
  } finally {
    await db.exec("reset role");
  }
}

async function asWriter<T>(work: () => Promise<T>) {
  await db.exec("set role atlas_assessment_api");
  try {
    return await work();
  } finally {
    await db.exec("reset role");
  }
}

let benchmarkVersions: Record<string, string> | undefined;
const storeSession = (owner: string, snapshot: object, revision: number) =>
  db.query("select public.atlas_store_learning_session($1,$2,$3,$4,true) as revision", [
    owner,
    taskId,
    JSON.stringify(
      benchmarkVersions ? { ...snapshot, assessmentVersions: benchmarkVersions } : snapshot,
    ),
    revision,
  ]);
const finishSession = (owner: string, revision: number) =>
  db.query("select public.atlas_finish_learning_session($1,$2,$3) as result", [
    owner,
    taskId,
    revision,
  ]);
async function markServerCompletion() {
  const versions = await db.query<{ id: string; version: string }>(
    "select id,updated_at::text as version from public.words where user_id=$1",
    [alice],
  );
  benchmarkVersions = Object.fromEntries(versions.rows.map(({ id, version }) => [id, version]));
  await db.query(
    "insert into atlas_account.online_assessments(id,user_id,state,start_command,start_request,status,expires_at) values($1,$2,'{}',$1,'{}','complete',now() + interval '1 hour')",
    [taskId, alice],
  );
}
const verifiedMark = {
  matchingDone: true,
  matchingErrors: 0,
  meaning: { correct: true, confidence: 0 },
  context: { correct: true, confidence: 0 },
};
function serverSnapshot(phase: string, words = [{ id: wordId, word: "Expand" }]) {
  return {
    id: taskId,
    version: 3,
    tutorial: false,
    phase,
    assessmentActions: [],
    queue: phase === "complete" ? [] : [wordId],
    words,
    assessment: { [wordId]: verifiedMark },
  };
}

describe("Postgres ownership, atomicity and quotas", () => {
  test("licensed personal copy backfill uses the bound historical revision and preserves edits and scores", async () => {
    const credit = {
      license: "CC BY-SA 4.0",
      attribution: "Fixture author",
      source: "https://example.org/source",
    };
    await db.query(
      "insert into public.atlas_lexicon_entries(id,word_key,part_of_speech,sense_key,revision,content,digest) values ($1,'fixture-credit','Noun',repeat('a',64),2,'{}',repeat('b',64))",
      [wordId],
    );
    await db.query(
      "insert into public.atlas_lexicon_entry_revisions(entry_id,revision,status,action,digest,content,provenance) values ($1,1,'human_reviewed','published',repeat('a',64),'{}',$2)",
      [wordId, JSON.stringify(credit)],
    );
    await db.query("update public.words set score=54,content=$1 where id=$2", [
      JSON.stringify({
        lexicon: { entryId: wordId, revision: 1, contractVersion: 1 },
        usageNote: "private edit",
      }),
      wordId,
    ]);
    const migration = await Bun.file(
      new URL(
        "../../../supabase/migrations/20261126153000_personal_lexicon_credit.sql",
        import.meta.url,
      ),
    ).text();
    await db.exec(migration);
    await db.exec(migration);
    expect(
      (await db.query("select score,content from public.words where id=$1", [wordId])).rows[0],
    ).toMatchObject({
      score: 54,
      content: {
        usageNote: "private edit",
        lexicon: { revision: 1 },
        attribution: { source: credit.source, author: credit.attribution, license: credit.license },
      },
    });
  });
  test("product migration restricts direct profile writes and preserves the goal RPC", async () => {
    await asUser(alice, async () => {
      expect((await db.query("select public.atlas_live_session() ok")).rows).toEqual([
        { ok: true },
      ]);
      expect(
        (
          await db.query(
            "select has_any_column_privilege(current_user,'public.profiles','UPDATE') ok",
          )
        ).rows,
      ).toEqual([{ ok: false }]);
      await expect(db.query("update public.profiles set daily_goal=30")).rejects.toMatchObject({
        code: "42501",
      });
      expect((await db.query("select public.set_daily_goal(50) goal")).rows).toEqual([
        { goal: 50 },
      ]);
    });
  });
  test("a bounded library page rejects intervening inserts, updates and deletes", async () => {
    await db.query(
      "insert into public.words(user_id,word) select $1,'Synthetic '||i from generate_series(1,1100)i",
      [alice],
    );
    const page = (rev: string | null, time: string | null, id: string | null) =>
      db
        .query<{
          page: { total: number; revision: string; rows: { id: string; updated_at: string }[] };
        }>("select public.atlas_word_page($1,$2,$3) page", [rev, time, id])
        .then((q) => q.rows[0].page);
    await asUser(alice, async () => {
      for (const mutation of [
        "insert into public.words(user_id,word) values(auth.uid(),'New')",
        "update public.words set word='Updated' where word='New'",
        "delete from public.words where word='Updated'",
      ]) {
        const first = await page(null, null, null);
        await db.exec(mutation);
        const end = first.rows.at(-1);
        assert(end);
        await expect(page(first.revision, end.updated_at, end.id)).rejects.toMatchObject({
          code: "40001",
        });
      }
      const first = await page(null, null, null);
      const rows = [...first.rows];
      while (rows.length < first.total) {
        const end = rows.at(-1);
        assert(end);
        const next = await page(first.revision, end.updated_at, end.id);
        expect(next.rows.length).toBeGreaterThan(0);
        rows.push(...next.rows);
      }
      expect(new Set(rows.map((w) => w.id)).size).toBe(1101);
    });
  });
  test("versioned plan, atomic day import, owner export and session revocation", async () => {
    await db.query("update public.words set content=$1 where id=$2", [
      JSON.stringify({ srs: { interval: 12 } }),
      wordId,
    ]);
    const cmd = crypto.randomUUID(),
      importId = crypto.randomUUID();
    const plan = { size: 30, groups: [{ day: 60, words: [wordId] }], exclusions: [] };
    const save = (revision: number, command: string, doc: unknown) =>
      db.query("select public.atlas_save_plan($1,$2,$3) result", [
        revision,
        command,
        JSON.stringify(doc),
      ]);
    const add = (revision: number, command: string, name: string) =>
      db.query<{ result: { revision: number; plan: typeof plan } }>(
        "select public.atlas_import_to_day($1,$2,60,$3,$4) result",
        [revision, command, JSON.stringify(plan), JSON.stringify([{ word: name }])],
      );
    await asUser(alice, async () => {
      const first = await save(0, cmd, plan);
      expect((await save(0, cmd, plan)).rows).toEqual(first.rows);
      await expect(
        db.query("select public.atlas_import_to_day(1,$1,1,$2,$3,true)", [
          crypto.randomUUID(),
          JSON.stringify(plan),
          JSON.stringify([{ word: "Expand" }]),
        ]),
      ).rejects.toMatchObject({ code: "23505" });
      const next = await add(1, importId, "Second");
      expect(next.rows[0].result.revision).toBe(2);
      expect((await add(1, importId, "Second")).rows[0].result.plan).toEqual(
        next.rows[0].result.plan,
      );
      await expect(add(1, crypto.randomUUID(), "Uncommitted")).rejects.toMatchObject({
        code: "40001",
      });
      expect(
        (await db.query("select from public.words where word='Uncommitted'")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select public.atlas_export_account($1)->'counts'->>'words' n", [alice]))
          .rows,
      ).toEqual([{ n: "2" }]);
      const exported = await db.query<{
        words: { id: string; content: { srs?: { interval: number } } }[];
      }>("select public.atlas_export_account($1)->'data'->'words' words", [alice]);
      expect(exported.rows[0].words.find((row) => row.id === wordId)?.content.srs).toEqual({
        interval: 12,
      });
      await db.query("delete from public.words where id=$1", [wordId]);
      expect((await db.query("select public.atlas_read_plan()->>'revision' r")).rows).toEqual([
        { r: "3" },
      ]);
    });
    await asUser(bob, async () => {
      expect((await db.query("select public.atlas_read_plan()->'plan' p")).rows).toEqual([
        { p: null },
      ]);
      await expect(
        db.query("select public.atlas_export_account($1)", [alice]),
      ).rejects.toMatchObject({ code: "42501" });
    });
    await asUser(alice, async () => {
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          session_id: alice,
          sub: alice,
          amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - 600 }],
        }),
      ]);
      expect(
        (
          await db.query(
            "select public.atlas_live_session() live,public.atlas_confirm_account($1) recent",
            [alice],
          )
        ).rows,
      ).toEqual([{ live: true, recent: false }]);
      await expect(
        db.query("select public.atlas_export_account($1)", [alice]),
      ).rejects.toMatchObject({ code: "42501" });
    });
    await db.query("delete from auth.sessions where user_id=$1", [alice]);
    await asUser(alice, async () => {
      expect((await db.query("select * from public.words")).rows).toBeEmpty();
      await expect(db.query("select public.set_daily_goal(30)")).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        db.query("select public.atlas_export_account($1)", [alice]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
  test("word CAS rejects a stale tab after an authoritative score and a newer note", async () => {
    const original = await db.query<{ updated_at: string; score: number }>(
      "select updated_at::text,score from public.words where id=$1",
      [wordId],
    );
    const version = original.rows[0].updated_at;
    await markServerCompletion();
    await asWriter(async () => {
      await storeSession(alice, serverSnapshot("complete"), 0);
      await finishSession(alice, 1);
    });
    await asUser(alice, async () => {
      const winner = await db.query(
        "update public.words set content=$1::jsonb where id=$2 returning id",
        [
          JSON.stringify({ word: "Expand", meanings: ["Başka sekmede yazılan kişisel not"] }),
          wordId,
        ],
      );
      expect(winner.rows).toHaveLength(1);
      const stale = await db.query(
        "update public.words set content=$1::jsonb " +
          "where id=$2 and updated_at=$3 and score=0 and word='Expand' returning id",
        [JSON.stringify({ word: "Expand", meanings: ["Eski kayıt"] }), wordId, version],
      );
      expect(stale.rows).toHaveLength(0);
    });
    const result = await db.query<{ score: number; content: { meanings: string[] } }>(
      "select score,content from public.words where id=$1",
      [wordId],
    );
    expect(result.rows[0].score).toBe(88);
    expect(result.rows[0].content.meanings).toEqual(["Başka sekmede yazılan kişisel not"]);
    await asUser(bob, async () => {
      const foreign = await db.query(
        "update public.words set word='Steal' where id=$1 and updated_at=$2 returning id",
        [wordId, version],
      );
      expect(foreign.rows).toHaveLength(0);
    });
  });
  test("legacy bulk scoring and protected mutations are denied to owners and other accounts", async () => {
    for (const owner of [alice, bob]) {
      await asUser(owner, async () => {
        await expect(
          db.query("select public.apply_word_scores($1)", [
            JSON.stringify([
              { id: wordId, score: 100 },
              { id: wordId, score: 88 },
            ]),
          ]),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          db.query("update public.words set score=100 where id=$1", [wordId]),
        ).rejects.toMatchObject({ code: "42501" });
      });
    }
    await asUser(alice, async () => {
      await expect(
        db.query("update public.words set content=$1 where id=$2", [
          JSON.stringify({ srs: { interval: 99 }, score: 100 }),
          wordId,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    });
    expect(
      (await db.query<{ score: number }>("select score from public.words where id=$1", [wordId]))
        .rows[0].score,
    ).toBe(0);
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
  test("all application tables have RLS and definer functions use the reviewed role allowlist", async () => {
    const result = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' order by relname",
    );
    const baselineTables = [
      "ai_usage",
      "completed_goal_days",
      "daily_word_completions",
      "learning_results",
      "learning_sessions",
      "profiles",
      "words",
    ];
    // Strict schema allowlist: a new public table must be reviewed, not silently ignored.
    expect(result.rows.map((row) => row.relname)).toEqual(
      [
        ...baselineTables,
        "atlas_lexicon_entries",
        "atlas_lexicon_jobs",
        "atlas_lexicon_entry_revisions",
        "atlas_tooltip_queue",
      ].sort(),
    );
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
    // The exact reviewed three-table ledger keeps RLS and denies all public-role access.
    const servicePermissions: Record<string, string[]> = {
      atlas_lexicon_entries: ["SELECT", "INSERT", "UPDATE"],
      atlas_lexicon_jobs: ["SELECT", "INSERT", "UPDATE"],
      atlas_lexicon_entry_revisions: ["SELECT", "INSERT"],
      atlas_tooltip_queue: ["SELECT", "INSERT", "UPDATE"],
    };
    for (const [table, allowed] of Object.entries(servicePermissions)) {
      const policies = await db.query<{ count: number }>(
        "select count(*)::integer as count from pg_policies where schemaname='public' and tablename=$1",
        [table],
      );
      expect(policies.rows[0].count).toBe(0);
      for (const role of ["anon", "authenticated", "service_role"] as const) {
        for (const operation of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
          const privilege = await db.query<{ allowed: boolean }>(
            `select has_table_privilege('${role}','public.${table}','${operation}') as allowed`,
          );
          expect(privilege.rows[0].allowed).toBe(
            role === "service_role" && allowed.includes(operation),
          );
        }
      }
    }
    const reviewed: Record<string, { args: string; count: number; role: string }> = {
      atlas_export_account: { args: "uuid", count: 1, role: "authenticated" },
      atlas_finish_learning_session: {
        args: "uuid,uuid,integer",
        count: 3,
        role: "atlas_assessment_api",
      },
      atlas_finish_verified_session: {
        args: "uuid,uuid,integer",
        count: 3,
        role: "atlas_learning_mutator",
      },
      atlas_lexicon_claim_v1: { args: "text,text,text,uuid", count: 4, role: "service_role" },
      atlas_lexicon_publish_v1: {
        args: "text,text,text,uuid,text,text,text,jsonb,jsonb,text",
        count: 10,
        role: "service_role",
      },
      atlas_live_session: { args: "", count: 0, role: "authenticated" },
      atlas_online_assessment_active: { args: "", count: 0, role: "authenticated" },
      atlas_save_plan: { args: "integer,uuid,jsonb", count: 3, role: "authenticated" },
      atlas_store_learning_session: {
        args: "uuid,uuid,jsonb,integer,boolean",
        count: 5,
        role: "atlas_assessment_api",
      },
      set_daily_goal: { args: "integer", count: 1, role: "authenticated" },
    };
    const functions = await db.query<{
      proname: string;
      pronargs: number;
      proconfig: string[] | null;
    }>(
      "select p.proname, p.pronargs, p.proconfig from pg_proc p " +
        "join pg_namespace n on n.oid=p.pronamespace " +
        "where n.nspname='public' and p.prosecdef order by p.proname",
    );
    expect(functions.rows.map((row) => [row.proname, row.pronargs])).toEqual(
      Object.entries(reviewed).map(([name, entry]) => [name, entry.count]),
    );
    for (const fn of functions.rows) {
      expect(fn.proconfig).toContain('search_path=""');
      const entry = reviewed[fn.proname];
      const identity = `public.${fn.proname}(${entry.args})`;
      for (const role of ["anon", "authenticated", "service_role", "atlas_assessment_api"]) {
        const privilege = await db.query<{ allowed: boolean }>(
          "select has_function_privilege($1, $2, 'EXECUTE') as allowed",
          [role, identity],
        );
        expect(privilege.rows[0].allowed).toBe(role === entry.role);
      }
    }
  });
  test("durable tooltip SQL is service-only, atomic and fencing-token protected", async () => {
    const token = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const stale = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await db.query(
      "insert into public.atlas_tooltip_queue(word_key) values('evidence'),('climate')",
    );
    await asUser(alice, async () => {
      await expect(db.query("select * from public.atlas_tooltip_queue")).rejects.toThrow();
      await expect(
        db.query("select * from public.atlas_tooltip_claim_v1(1,$1::uuid)", [token]),
      ).rejects.toThrow();
    });
    await db.exec("set role service_role");
    try {
      const first = await db.query<{ word_key: string; lease_token: string }>(
        "select * from public.atlas_tooltip_claim_v1(1,$1::uuid)",
        [token],
      );
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0].lease_token).toBe(token);
      const key = first.rows[0].word_key;
      const wrong = await db.query<{ finished: boolean }>(
        "select public.atlas_tooltip_finish_v1($1,$2::uuid,'ready',null) as finished",
        [key, stale],
      );
      expect(wrong.rows[0].finished).toBe(false);
      const done = await db.query<{ finished: boolean }>(
        "select public.atlas_tooltip_finish_v1($1,$2::uuid,'ready',null) as finished",
        [key, token],
      );
      expect(done.rows[0].finished).toBe(true);
      const second = await db.query<{ word_key: string }>(
        "select * from public.atlas_tooltip_claim_v1(2,$1::uuid)",
        [stale],
      );
      expect(second.rows.map((row) => row.word_key)).not.toContain(key);
      const retry = await db.query<{ finished: boolean }>(
        "select public.atlas_tooltip_finish_v1($1,$2::uuid,'retry','LOOKUP_FAILED') as finished",
        [second.rows[0].word_key, stale],
      );
      expect(retry.rows[0].finished).toBe(true);
      const next = await db.query<{ word_key: string }>(
        "select * from public.atlas_tooltip_claim_v1(10,$1::uuid)",
        [token],
      );
      expect(next.rows).toHaveLength(0); // delayed backoff; no duplicate claim
    } finally {
      await db.exec("reset role");
    }
  });
  test("anonymous callers cannot read tables or execute app functions", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from public.words")).rejects.toThrow();
      await expect(db.query("select * from public.atlas_lexicon_entries")).rejects.toThrow();
      await expect(db.query("select public.import_words('[]')")).rejects.toThrow();
      await expect(db.query("select public.consume_ai_quota($1)", [alice])).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  });
  test("authenticated users cannot read or write the private shared Lexicon table", async () => {
    await asUser(alice, async () => {
      await expect(db.query("select * from public.atlas_lexicon_entries")).rejects.toThrow();
      await expect(
        db.query(
          "insert into public.atlas_lexicon_entries(word_key,part_of_speech,sense_key,content,digest) values('x','Noun',$1,'{}',$1)",
          ["a".repeat(64)],
        ),
      ).rejects.toThrow();
    });
  });
  test("another user's words cannot be selected, updated, deleted or reassigned", async () => {
    await asUser(bob, async () => {
      expect((await db.query("select * from public.words")).rows).toHaveLength(0);
      expect(
        (await db.query("update public.words set word='Steal' where id=$1 returning id", [wordId]))
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
    const snapshot = serverSnapshot("meaning");
    for (const owner of [alice, bob]) {
      await asUser(owner, async () => {
        await expect(
          db.query("select public.save_learning_session($1,$2,0)", [
            taskId,
            JSON.stringify(snapshot),
          ]),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(storeSession(owner, snapshot, 0)).rejects.toMatchObject({ code: "42501" });
      });
    }
    await asWriter(async () => {
      expect((await storeSession(alice, snapshot, 0)).rows).toEqual([{ revision: 1 }]);
      await expect(storeSession(alice, snapshot, 0)).rejects.toMatchObject({ code: "40001" });
      expect((await storeSession(alice, snapshot, 1)).rows).toEqual([{ revision: 2 }]);
      await expect(storeSession(alice, snapshot, 1)).rejects.toMatchObject({ code: "40001" });
      await expect(storeSession(bob, snapshot, 2)).rejects.toMatchObject({ code: "40001" });
    });
  });

  test("completion derives scores once, filters foreign words and isolates the result", async () => {
    const foreign = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.query("insert into public.words(id,user_id,word) values($1,$2,'Private')", [
      foreign,
      bob,
    ]);
    const words = [
      { id: wordId, word: "Expand" },
      { id: foreign, word: "Private" },
    ];
    const snapshot = {
      ...serverSnapshot("complete", words),
      scoreChanges: { [wordId]: 999, [foreign]: 100 },
      assessment: { [wordId]: verifiedMark, [foreign]: verifiedMark },
    };
    const expected = [{ result: { scores: [{ id: wordId, score: 88 }], practiceOnly: false } }];
    await markServerCompletion();
    await asWriter(async () => {
      await storeSession(alice, snapshot, 0);
      await expect(finishSession(bob, 1)).rejects.toMatchObject({ code: "P0002" });
      expect((await finishSession(alice, 1)).rows).toEqual(expected);
      expect((await finishSession(alice, 1)).rows).toEqual(expected);
      await expect(storeSession(alice, snapshot, 2)).rejects.toMatchObject({ code: "40001" });
      await expect(db.query("update public.words set score=100")).rejects.toMatchObject({
        code: "42501",
      });
    });
    await asUser(alice, async () => {
      await expect(
        db.query("select public.complete_learning_session($1,$2)", [
          taskId,
          JSON.stringify([{ id: wordId, score: 5 }]),
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(finishSession(alice, 1)).rejects.toMatchObject({ code: "42501" });
      expect(
        (await db.query("select revision,snapshot->'saved' as saved from public.learning_sessions"))
          .rows,
      ).toEqual([{ revision: 2, saved: true }]);
      expect((await db.query("select score from public.words where id=$1", [wordId])).rows).toEqual(
        [{ score: 88 }],
      );
      expect((await db.query("select * from public.learning_results")).rows).toHaveLength(1);
      expect((await db.query("select * from public.daily_word_completions")).rows).toHaveLength(1);
    });
    await asUser(bob, async () => {
      expect((await db.query("select id from public.learning_sessions")).rows).toEqual([]);
      expect((await db.query("select session_id from public.learning_results")).rows).toEqual([]);
      expect((await db.query("select word_id from public.daily_word_completions")).rows).toEqual(
        [],
      );
      expect(
        (await db.query("select score from public.words where id=$1", [foreign])).rows,
      ).toEqual([{ score: 0 }]);
    });
  });

  test("invalid completion rolls back and an unfinished session cannot be finalized", async () => {
    const second = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.query("insert into public.words(id,user_id,word) values($1,$2,'Second')", [
      second,
      alice,
    ]);
    const words = [
      { id: wordId, word: "Expand" },
      { id: second, word: "Second" },
    ];
    await markServerCompletion();
    await asWriter(async () => {
      await storeSession(alice, serverSnapshot("meaning", words), 0);
      await expect(finishSession(alice, 1)).rejects.toMatchObject({ code: "22023" });
      // The second word has no verified assessment. A failure after grading the first word rolls back.
      await storeSession(alice, serverSnapshot("complete", words), 1);
      await expect(finishSession(alice, 1)).rejects.toMatchObject({ code: "40001" });
      await expect(finishSession(alice, 2)).rejects.toMatchObject({ code: "22023" });
    });
    await asUser(alice, async () => {
      expect((await db.query("select score from public.words order by id")).rows).toEqual([
        { score: 0 },
        { score: 0 },
      ]);
      expect((await db.query("select * from public.learning_results")).rows).toHaveLength(0);
      expect((await db.query("select * from public.daily_word_completions")).rows).toHaveLength(0);
      expect(
        (await db.query("select revision,completed_at from public.learning_sessions")).rows,
      ).toEqual([{ revision: 2, completed_at: null }]);
    });
  });
  test("AI usage is server-only and account-isolated beyond both former fixed limits", async () => {
    await asUser(alice, async () => {
      await expect(db.query("select public.consume_ai_quota($1)", [alice])).rejects.toThrow();
      await expect(db.query("select * from public.ai_usage")).rejects.toThrow();
    });
    await db.exec("set role service_role");
    try {
      const usage = await db.query<{ allowed: boolean }>(
        "select public.consume_ai_quota($1) as allowed from generate_series(1,45)",
        [alice],
      );
      expect(usage.rows).toHaveLength(45);
      expect(usage.rows.every((row) => row.allowed)).toBe(true);
      expect((await db.query("select public.consume_ai_quota($1) allowed", [bob])).rows).toEqual([
        { allowed: true },
      ]);
      expect(
        (
          await db.query(
            "select requests from public.ai_usage where user_id = $1 and bucket = date_trunc('day', now(), 'UTC')",
            [alice],
          )
        ).rows,
      ).toEqual([{ requests: 45 }]);
      expect(
        (
          await db.query(
            "select requests from public.ai_usage where user_id = $1 and bucket = date_trunc('day', now(), 'UTC')",
            [bob],
          )
        ).rows,
      ).toEqual([{ requests: 1 }]);
    } finally {
      await db.exec("reset role");
    }
  });
});

test("verified session MFA and direct revocation gate", async () => {
  await asUser(alice, async () => {
    expect(
      (await db.query<{ ok: boolean }>("select public.atlas_control_mfa() ok")).rows[0].ok,
    ).toBe(false);
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: alice, session_id: alice, aal: "aal2" }),
    ]);
    expect(
      (await db.query<{ ok: boolean }>("select public.atlas_control_mfa() ok")).rows[0].ok,
    ).toBe(true);
    await expect(
      db.query("select public.atlas_apply_editorial($1,$1,'[]')", [alice]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  await db.query("delete from auth.sessions where user_id=$1", [alice]);
  await asUser(alice, async () => {
    await expect(db.query("select public.atlas_request_session_gate()")).rejects.toMatchObject({
      code: "PT401",
    });
  });
  await asUser(bob, () => db.query("select public.atlas_request_session_gate()"));
});
