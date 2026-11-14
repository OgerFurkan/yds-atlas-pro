/**
 * Phase 4B v5B: REAL PostgreSQL multi-connection concurrency acceptance.
 * Only an ephemeral localhost Docker database is accepted. Never point at staging.
 * Run via scripts/quality/phase4b-v5b-run-local.ps1. Not included in default test suite.
 */
import { SQL } from "bun";
import { readdir, readFile } from "node:fs/promises";

const DB = "atlas_v5b_isolated";
const OWNER = "11111111-1111-4111-8111-111111111111";
const WORD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPLETION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SAVE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("V5B ASSERTION FAILED: " + message);
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function client(port: number, username: string, password: string) {
  return new SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port,
    database: DB,
    username,
    password,
    max: 1,
    connectionTimeout: 5,
    prepare: false,
  });
}

async function readProjectSql(relative: string): Promise<string> {
  return (await readFile(new URL("../../" + relative, import.meta.url), "utf8")).replace(/^\uFEFF/, "");
}

async function waitUntilBothBlocked(admin: SQL, pids: readonly number[]): Promise<void> {
  const deadline = Date.now() + 9_000;
  while (Date.now() < deadline) {
    const rows = await admin.unsafe(
      "select pid,wait_event_type from pg_stat_activity where pid=$1::int or pid=$2::int",
      [pids[0], pids[1]],
    );
    if (rows.length === 2 && rows.every((row: { wait_event_type: unknown }) => row.wait_event_type === "Lock")) {
      console.log("PASS: Both independent PostgreSQL backends are blocked on a real row lock.");
      return;
    }
    await delay(70);
  }
  throw new Error("Could not prove two concurrent lock waiters; do not claim concurrency verified.");
}

async function raceOnSessionLock<T>(
  admin: SQL,
  blocker: SQL,
  actorA: SQL,
  actorB: SQL,
  sessionId: string,
  a: () => Promise<T>,
  b: () => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const pids = [
    Number((await actorA.unsafe("select pg_backend_pid() as pid"))[0]?.pid),
    Number((await actorB.unsafe("select pg_backend_pid() as pid"))[0]?.pid),
  ];
  check(pids.every(Number.isInteger) && pids[0] !== pids[1], "actor connections are not independent");
  let pending: [Promise<T>, Promise<T>] | undefined;
  try {
    await blocker.begin(async (tx) => {
      const locked = await tx.unsafe("select id from public.learning_sessions where id = $1::uuid for update", [sessionId]);
      check(locked.length === 1, "session row not found for lock barrier");
      // The Promise.resolve starts Bun's lazy queries while the row remains locked.
      pending = [a(), b()];
      await waitUntilBothBlocked(admin, pids);
      // Returning commits this transaction and releases the lock for both actors.
    });
  } catch (err) {
    if (pending) await Promise.allSettled(pending);
    throw err;
  }
  check(pending, "race queries were not launched");
  return await Promise.allSettled(pending);
}

async function main() {
  const port = Number(process.env.ATLAS_V5B_PORT);
  const adminPassword = process.env.ATLAS_V5B_ADMIN_PASSWORD ?? "";
  const rolePassword = process.env.ATLAS_V5B_ROLE_PASSWORD ?? "";
  check(process.env.ATLAS_V5B_LOCAL_ONLY === "DOCKER_CREATED_IN_THIS_RUN", "Docker isolation sentinel is absent");
  check(Number.isInteger(port) && port >= 1024 && port <= 65535, "local test port is invalid");
  check(/^[a-f0-9]{32}$/.test(adminPassword) && /^[a-f0-9]{32}$/.test(rolePassword), "ephemeral passwords are invalid");
  // Nothing in this script reads DATABASE_URL, SUPABASE_URL, or a remote hostname.
  const admin = client(port, "postgres", adminPassword);
  const blocker = client(port, "postgres", adminPassword);
  const actorA = client(port, "service_role", rolePassword);
  const actorB = client(port, "service_role", rolePassword);
  try {
    const identity = await admin.unsafe("select current_database() as name, inet_server_addr()::text as address, version() as version");
    check(identity[0]?.name === DB, "not the disposable v5B database");
    check(String(identity[0]?.version).includes("PostgreSQL 16"), "expected PostgreSQL 16");
    console.log("PASS: Connected to isolated PostgreSQL 16 test database.");
    // This is a fresh Docker database created by the PowerShell runner, not user data.
    await admin.unsafe(`
      create role anon;
      create role authenticated;
      create role service_role login bypassrls password '${rolePassword}';
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon,authenticated,service_role;
    `).simple();
    const migrations = new URL("../../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = (await readFile(new URL(name, migrations), "utf8")).replace(/^\uFEFF/, "");
      await admin.unsafe(sql).simple();
    }
    await admin.unsafe(`
      grant usage on schema public to service_role;
      grant all privileges on all tables in schema public to service_role;
    `).simple();
    for (const file of [
      "docs/architecture/phase4b-v3-atomic-completion-DRAFT.sql",
      "docs/architecture/phase4b-v4-legacy-cutover-REVIEW-ONLY.sql",
      "docs/architecture/phase4b-v5a-session-writer-REVIEW-ONLY.sql",
      "docs/architecture/phase4b-v5a-session-cutover-REVIEW-ONLY.sql",
    ]) {
      await admin.unsafe(await readProjectSql(file)).simple();
    }
    console.log("PASS: Migration history and review-only SQL candidates loaded into Docker only.");

    await admin.unsafe("insert into auth.users(id) values ($1::uuid)", [OWNER]);
    await admin.unsafe("insert into public.profiles(user_id,daily_goal) values ($1::uuid,20)", [OWNER]);
    await admin.unsafe("insert into public.words(id,user_id,word) values ($1::uuid,$2::uuid,'Evidence')", [WORD, OWNER]);
    const completionSnapshot = {
      id: COMPLETION_ID, version: 3, tutorial: false, phase: "complete", saved: false,
      queue: [], words: [{ id: WORD, score: 20 }], scoreChanges: { [WORD]: 20 },
      assessment: {
        [WORD]: {
          matchingDone: true, matchingErrors: 0,
          meaning: { correct: true, confidence: 0 },
          context: { correct: true, confidence: 0 },
        },
      },
    };
    // Bun SQL can treat JSON-typed string parameters as a JSON string value.
    // Bind JSON.stringify(...) as TEXT first, then let PostgreSQL parse it as JSONB.
    // This probe fails before fixtures are written if the binding is not structural.
    const jsonProbe = await admin.unsafe(
      "select jsonb_typeof(($1::text)::jsonb) as snapshot_type, jsonb_typeof(($2::text)::jsonb) as scores_type",
      [JSON.stringify(completionSnapshot), JSON.stringify([{ id: WORD, score: 88 }])],
    );
    check(jsonProbe[0]?.snapshot_type === "object" && jsonProbe[0]?.scores_type === "array",
      "JSONB parameter binding must preserve object and array types");
    console.log("PASS: Bun JSON fixtures bind as PostgreSQL JSONB objects/arrays (no double encoding).");
    await admin.unsafe(
      "insert into public.learning_sessions(id,user_id,snapshot,revision) values ($1::uuid,$2::uuid,($3::text)::jsonb,1)",
      [COMPLETION_ID, OWNER, JSON.stringify(completionSnapshot)],
    );
    const scores = JSON.stringify([{ id: WORD, score: 88 }]);
    const ratings = JSON.stringify([{ id: WORD, rating: "good" }]);
    const finish = (sql: SQL) => Promise.resolve(sql.unsafe(
      "select public.complete_learning_session_v3($1::uuid,$2::uuid,$3::integer,($4::text)::jsonb,($5::text)::jsonb) as value",
      [OWNER, COMPLETION_ID, 1, scores, ratings],
    )) as Promise<{ value: { id: string; score: number }[] }[]>;
    const completions = await raceOnSessionLock(admin, blocker, actorA, actorB, COMPLETION_ID,
      () => finish(actorA), () => finish(actorB));
    check(completions.every((r) => r.status === "fulfilled"), "concurrent replay request failed rather than returning stored result");
    for (const result of completions) {
      if (result.status !== "fulfilled") continue;
      check(JSON.stringify(result.value[0]?.value) === JSON.stringify([{ id: WORD, score: 88 }]), "completion returned mismatched scores");
    }
    const completed = await admin.unsafe(`
      select
        (select count(*)::int from public.learning_results) as ledger_count,
        (select count(*)::int from public.word_review_schedules) as schedule_count,
        (select repetitions from public.word_review_schedules where word_id = $1::uuid) as repetitions,
        (select score from public.words where id = $1::uuid) as score,
        (select revision from public.learning_sessions where id = $2::uuid) as revision,
        (select count(*)::int from public.daily_word_completions) as daily_count
    `, [WORD, COMPLETION_ID]);
    const row = completed[0];
    check(row?.ledger_count === 1 && row.schedule_count === 1 && row.repetitions === 1 &&
      row.score === 88 && row.revision === 2 && row.daily_count === 1,
      "concurrent completion wrote more than once or lost progress");
    console.log("PASS: Two simultaneous v3 completions yielded exactly one ledger, one SRS rating and one daily completion.");

    const saveSnapshot = { id: SAVE_ID, version: 3, tutorial: false, phase: "meaning", queue: [], words: [] };
    await admin.unsafe(
      "insert into public.learning_sessions(id,user_id,snapshot,revision) values ($1::uuid,$2::uuid,($3::text)::jsonb,1)",
      [SAVE_ID, OWNER, JSON.stringify(saveSnapshot)],
    );
    const save = (sql: SQL, phase: string) => Promise.resolve(sql.unsafe(
      "select public.save_learning_session_v5($1::uuid,$2::uuid,($3::text)::jsonb,$4::integer) as revision",
      [OWNER, SAVE_ID, JSON.stringify({ ...saveSnapshot, phase }), 1],
    )) as Promise<{ revision: number }[]>;
    const saves = await raceOnSessionLock(admin, blocker, actorA, actorB, SAVE_ID,
      () => save(actorA, "context"), () => save(actorB, "matching"));
    const fulfilled = saves.filter((r) => r.status === "fulfilled");
    const rejected = saves.filter((r) => r.status === "rejected");
    check(fulfilled.length === 1 && rejected.length === 1, "CAS race must accept one update and reject one");
    check(fulfilled[0]?.status === "fulfilled" && fulfilled[0].value[0]?.revision === 2, "CAS winner must be revision 2");
    const state = await admin.unsafe("select revision,snapshot->>'phase' as phase from public.learning_sessions where id=$1::uuid", [SAVE_ID]);
    check(state[0]?.revision === 2 && ["context", "matching"].includes(state[0]?.phase), "CAS resulted in inconsistent session state");
    console.log("PASS: Two simultaneous v5 saves observed CAS: one revision-2 winner and one conflict.");
    console.log("PASS: V5B REAL POSTGRES CONCURRENCY ACCEPTANCE COMPLETE. No remote database was touched.");
  } finally {
    await Promise.allSettled([admin.close(), blocker.close(), actorA.close(), actorB.close()]);
  }
}

await main().catch((error: unknown) => {
  // Never echo connection credentials. Error messages from local PG are safe here.
  console.error(error instanceof Error ? error.message : "Unknown v5B local failure");
  process.exitCode = 1;
});
