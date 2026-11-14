/**
 * v5C-D disposable PostgreSQL 16 cutover acceptance. NOT a migration.
 * Hard-coded localhost, isolated DB, newly generated credentials from runner.
 * No remote Supabase credentials, API endpoints or environment files are read.
 */
import { SQL } from "bun";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DATABASE = "atlas_v5cd_isolated";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ONE_WORD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ONE_SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function insist(condition, message) {
  if (!condition) throw new Error("V5C-D ASSERTION FAILED: " + message);
}
function dbClient(port, username, password) {
  return new SQL({
    adapter: "postgres", hostname: "127.0.0.1", port, database: DATABASE,
    username, password, max: 1, connectionTimeout: 5, prepare: false,
  });
}
async function textSql(root, relative) {
  return (await readFile(join(root, relative), "utf8")).replace(/^\uFEFF/, "");
}
async function asAuthenticated(admin, owner, command) {
  return admin.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx.unsafe("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    return command(tx);
  });
}
async function denied(label, op) {
  let failure;
  try { await op(); } catch (error) { failure = error; }
  insist(failure, label + " succeeded, expected privilege error");
  const code = failure?.code;
  insist(code === "42501" || /permission denied|not permitted/i.test(String(failure?.message)),
    label + " failed for an unexpected reason: " + (code ?? "unknown"));
}
function sampleSnapshot(id, wordId) {
  return {
    id, version: 3, tutorial: false, phase: "complete", saved: false,
    queue: [], words: [{ id: wordId, score: 20 }], scoreChanges: { [wordId]: 20 },
    assessment: {
      [wordId]: { matchingDone: true, matchingErrors: 0,
        meaning: { correct: true, confidence: 0 },
        context: { correct: true, confidence: 0 } },
    },
  };
}
function assertEqual(actual, expected, message) {
  insist(actual === expected, `${message}; expected ${expected}, got ${actual}`);
}

async function main() {
  const port = Number(process.env.ATLAS_V5CD_PORT);
  const adminPassword = process.env.ATLAS_V5CD_ADMIN_PASSWORD ?? "";
  const rolePassword = process.env.ATLAS_V5CD_ROLE_PASSWORD ?? "";
  const project = process.env.ATLAS_V5CD_PROJECT_PATH ?? "";
  insist(process.env.ATLAS_V5CD_LOCAL_ONLY === "CREATED_BY_V5CD_DOCKER_RUNNER", "isolation sentinel missing");
  insist(Number.isInteger(port) && port > 1023 && port <= 65535, "invalid ephemeral port");
  insist(/^[a-f0-9]{32}$/.test(adminPassword) && /^[a-f0-9]{32}$/.test(rolePassword), "invalid ephemeral credentials");
  insist(project.length > 4, "project path not configured");
  const admin = dbClient(port, "postgres", adminPassword);
  const service = dbClient(port, "service_role", rolePassword);
  try {
    const identity = await admin.unsafe("select current_database() as db, version() as version");
    assertEqual(identity[0]?.db, DATABASE, "not the isolated database");
    insist(String(identity[0]?.version).includes("PostgreSQL 16"), "PostgreSQL 16 required");
    console.log("PASS 01: Disposable PostgreSQL 16 database connected on loopback.");

    await admin.unsafe(`
      create role anon;
      create role authenticated;
      create role service_role login bypassrls password '${rolePassword}';
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
    `).simple();
    const migrationsDir = join(project, "supabase", "migrations");
    const migrationNames = (await readdir(migrationsDir)).filter(name => name.endsWith(".sql")).sort();
    insist(migrationNames.length >= 3, "unexpected migration history");
    for (const name of migrationNames) {
      await admin.unsafe(await textSql(project, `supabase/migrations/${name}`)).simple();
    }
    // Mirrors the already verified local v5B service_role fixture; never changes staging grants.
    await admin.unsafe(`
      grant usage on schema public to service_role;
      grant all privileges on all tables in schema public to service_role;
    `).simple();
    for (const name of [
      "phase4b-v3-atomic-completion-DRAFT.sql",
      "phase4b-v5a-session-writer-REVIEW-ONLY.sql",
      "phase4b-v5cc-goal-writer-REVIEW-ONLY.sql",
      "phase4b-v5cc-ledger-cutover-REVIEW-ONLY.sql",
    ]) {
      await admin.unsafe(await textSql(project, `docs/architecture/${name}`)).simple();
    }
    console.log("PASS 02: Migration history + REVIEW-only v3/v5/v6/cutover SQL loaded into Docker only.");

    const acl = (await admin.unsafe(`select
      has_function_privilege('authenticated','public.complete_learning_session(uuid,jsonb)','EXECUTE') as old_complete,
      has_function_privilege('authenticated','public.save_learning_session(uuid,jsonb,integer)','EXECUTE') as old_save,
      has_function_privilege('authenticated','public.set_daily_goal(integer)','EXECUTE') as old_goal,
      has_function_privilege('authenticated','public.set_daily_goal_v6(uuid,integer)','EXECUTE') as user_v6,
      has_function_privilege('anon','public.set_daily_goal_v6(uuid,integer)','EXECUTE') as anon_v6,
      has_function_privilege('service_role','public.set_daily_goal_v6(uuid,integer)','EXECUTE') as service_v6,
      has_function_privilege('service_role','public.save_learning_session_v5(uuid,uuid,jsonb,integer)','EXECUTE') as service_v5,
      has_function_privilege('service_role','public.complete_learning_session_v3(uuid,uuid,integer,jsonb,jsonb)','EXECUTE') as service_v3,
      has_table_privilege('authenticated','public.learning_results','INSERT') as result_insert,
      has_table_privilege('authenticated','public.daily_word_completions','INSERT') as daily_insert,
      has_table_privilege('authenticated','public.completed_goal_days','INSERT') as milestone_insert,
      has_table_privilege('authenticated','public.learning_sessions','INSERT') as session_insert,
      has_table_privilege('authenticated','public.learning_sessions','UPDATE') as session_update,
      has_table_privilege('authenticated','public.words','UPDATE') as word_update
    `))[0];
    for (const key of ["old_complete", "old_save", "old_goal", "user_v6", "anon_v6", "result_insert", "daily_insert", "milestone_insert", "session_insert", "session_update"]) {
      assertEqual(acl?.[key], false, `unsafe permission still exists: ${key}`);
    }
    for (const key of ["service_v3", "service_v5", "service_v6", "word_update"]) {
      assertEqual(acl?.[key], true, `required grant missing: ${key}`);
    }
    console.log("PASS 03: Real role ACLs reject legacy save/complete/goal and direct result/progress writes.");

    await admin.unsafe("insert into auth.users(id) values ($1::uuid),($2::uuid)", [A, B]);
    await admin.unsafe("insert into public.profiles(user_id,daily_goal) values ($1::uuid,20),($2::uuid,20)", [A, B]);
    await admin.unsafe("insert into public.words(id,user_id,word,score) values ($1::uuid,$2::uuid,'Alpha',20)", [ONE_WORD, A]);
    await admin.unsafe("insert into public.words(user_id,word,score) values ($1::uuid,'Beta',20)", [B]);

    // PostgreSQL permission errors, not just has_table_privilege inspection.
    await denied("forged daily completion", () => asAuthenticated(admin, A, tx =>
      Promise.resolve(tx.unsafe("insert into public.daily_word_completions(user_id,day,word_id) values($1::uuid,current_date,$2::uuid)", [A, ONE_WORD]))));
    await denied("forged milestone", () => asAuthenticated(admin, A, tx =>
      Promise.resolve(tx.unsafe("insert into public.completed_goal_days(user_id,day,goal) values($1::uuid,current_date,20)", [A]))));
    await denied("forged completion ledger", () => asAuthenticated(admin, A, tx =>
      Promise.resolve(tx.unsafe("insert into public.learning_results(session_id,user_id,scores) values($1::uuid,$2::uuid,'[]'::jsonb)", [ONE_SESSION, A]))));
    await denied("direct learning session INSERT", () => asAuthenticated(admin, A, tx =>
      Promise.resolve(tx.unsafe("insert into public.learning_sessions(id,user_id,snapshot) values($1::uuid,$2::uuid,'{}'::jsonb)", [ONE_SESSION, A]))));
    await denied("legacy goal RPC", () => asAuthenticated(admin, A, tx =>
      Promise.resolve(tx.unsafe("select public.set_daily_goal(10)"))));
    await denied("service-only goal RPC", () => asAuthenticated(admin, A, tx =>
      Promise.resolve(tx.unsafe("select public.set_daily_goal_v6($1::uuid,10)", [A]))));
    console.log("PASS 04: Authenticated SQL attempts to forge progress and call protected RPCs are denied.");

    // Real v5 save + real v3 completion, with authentic rows and idempotence.
    // Bun 1.x may JSON-encode values again when a JSON.stringify() string is bound
    // directly to a jsonb-typed placeholder. Force TEXT input, then parse as
    // jsonb in PostgreSQL. This does not relax any v5/v3 SQL validation.
    const firstSnapshotText = JSON.stringify(sampleSnapshot(ONE_SESSION, ONE_WORD));
    const wireShape = (await service.unsafe(`select
      jsonb_typeof($1::text::jsonb) as json_kind,
      ($1::text::jsonb->>'id' = $2::uuid::text) as id_ok,
      ($1::text::jsonb->>'tutorial' = 'false') as tutorial_ok`,
      [firstSnapshotText, ONE_SESSION]))[0];
    insist(wireShape?.json_kind === "object" && wireShape.id_ok === true &&
      wireShape.tutorial_ok === true,
      "Bun/PostgreSQL JSON parameter did not decode into a valid v5 snapshot object");
    console.log("PASS 04A: JSONB wire preflight confirms object, matching session ID and tutorial=false.");
    const saved = await service.unsafe("select public.save_learning_session_v5($1::uuid,$2::uuid,$3::text::jsonb,0) as revision", [
      A, ONE_SESSION, firstSnapshotText,
    ]);
    assertEqual(saved[0]?.revision, 1, "v5 create revision");
    let conflictError;
    try {
      await service.unsafe("select public.save_learning_session_v5($1::uuid,$2::uuid,$3::text::jsonb,0)", [
        A, ONE_SESSION, JSON.stringify(sampleSnapshot(ONE_SESSION, ONE_WORD)),
      ]);
    } catch (error) { conflictError = error; }
    // Bun SQL.PostgresError.code is the driver category (ERR_POSTGRES_SERVER_ERROR).
    // PostgreSQL SQLSTATE is in .errno, not .code. Require the real server 40001.
    insist(conflictError instanceof SQL.PostgresError &&
      conflictError.code === "ERR_POSTGRES_SERVER_ERROR" && conflictError.errno === "40001",
      `duplicate v5 create expected server CAS conflict SQLSTATE 40001; got driver=${String(conflictError?.code ?? "no-error")}, sqlstate=${String(conflictError?.errno ?? "none")}`);
    const afterConflict = await admin.unsafe(
      "select count(*)::int as rows, max(revision)::int as revision from public.learning_sessions where id=$1::uuid and user_id=$2::uuid",
      [ONE_SESSION, A],
    );
    assertEqual(afterConflict[0]?.rows, 1, "duplicate v5 save must not create extra session");
    assertEqual(afterConflict[0]?.revision, 1, "duplicate v5 save must not change revision");

    const ratings = JSON.stringify([{ id: ONE_WORD, rating: "good" }]);
    const scores = JSON.stringify([{ id: ONE_WORD, score: 88 }]);
    const complete = () => service.unsafe("select public.complete_learning_session_v3($1::uuid,$2::uuid,1,$3::text::jsonb,$4::text::jsonb) as result", [
      A, ONE_SESSION, scores, ratings,
    ]);
    const once = await complete();
    const again = await complete();
    insist(JSON.stringify(once[0]?.result) === JSON.stringify([{ id: ONE_WORD, score: 88 }]), "v3 first result mismatch");
    insist(JSON.stringify(again[0]?.result) === JSON.stringify(once[0]?.result), "v3 replay result mismatch");
    const state = (await admin.unsafe(`select
       (select count(*)::int from public.learning_results where user_id=$1::uuid) as ledger,
       (select count(*)::int from public.daily_word_completions where user_id=$1::uuid) as daily,
       (select count(*)::int from public.word_review_schedules where user_id=$1::uuid) as schedules,
       (select score from public.words where id=$2::uuid) as score,
       (select revision from public.learning_sessions where id=$3::uuid) as revision`,
      [A, ONE_WORD, ONE_SESSION]))[0];
    for (const [field, expected] of Object.entries({ ledger: 1, daily: 1, schedules: 1, score: 88, revision: 2 })) {
      assertEqual(state?.[field], expected, `v5 -> v3 completion ${field}`);
    }
    console.log("PASS 05: v5 save, CAS, v3 completion, idempotent ledger, SRS and daily progress verified.");

    // v6 threshold: 1 completion is insufficient for goal=10, then 9 real game completions.
    const preGoal = await service.unsafe("select public.set_daily_goal_v6($1::uuid,10) as goal", [A]);
    assertEqual(preGoal[0]?.goal, 10, "v6 goal result");
    let milestones = await admin.unsafe("select count(*)::int as n from public.completed_goal_days where user_id=$1::uuid", [A]);
    assertEqual(milestones[0]?.n, 0, "premature milestone recorded");
    for (let i = 2; i <= 10; i++) {
      const wordId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      await admin.unsafe("insert into public.words(id,user_id,word,score) values($1::uuid,$2::uuid,$3,20)", [wordId, A, `Evidence${i}`]);
      const start = await service.unsafe("select public.save_learning_session_v5($1::uuid,$2::uuid,$3::text::jsonb,0) as revision", [
        A, sessionId, JSON.stringify(sampleSnapshot(sessionId, wordId)),
      ]);
      assertEqual(start[0]?.revision, 1, `session ${i} create`);
      const result = await service.unsafe("select public.complete_learning_session_v3($1::uuid,$2::uuid,1,$3::text::jsonb,$4::text::jsonb) as result", [
        A, sessionId, JSON.stringify([{ id: wordId, score: 88 }]), JSON.stringify([{ id: wordId, rating: "good" }]),
      ]);
      insist(Array.isArray(result[0]?.result), `session ${i} result missing`);
    }
    milestones = await admin.unsafe("select count(*)::int as n from public.completed_goal_days where user_id=$1::uuid", [A]);
    assertEqual(milestones[0]?.n, 1, "10 genuine completions must yield one milestone");
    await service.unsafe("select public.set_daily_goal_v6($1::uuid,10)", [A]);
    milestones = await admin.unsafe("select count(*)::int as n from public.completed_goal_days where user_id=$1::uuid", [A]);
    assertEqual(milestones[0]?.n, 1, "v6 repeated goal call duplicates milestone");
    const other = (await admin.unsafe(`select
      (select daily_goal from public.profiles where user_id=$1::uuid) as goal,
      (select count(*)::int from public.daily_word_completions where user_id=$1::uuid) as daily,
      (select count(*)::int from public.completed_goal_days where user_id=$1::uuid) as milestones,
      (select count(*)::int from public.learning_results where user_id=$1::uuid) as ledger`, [B]))[0];
    for (const [field, expected] of Object.entries({ goal: 20, daily: 0, milestones: 0, ledger: 0 })) {
      assertEqual(other?.[field], expected, `other account ${field}`);
    }
    console.log("PASS 06: Ten real v3 completions reach goal=10 exactly once; other owner unchanged.");

    const readA = await asAuthenticated(admin, A, tx => Promise.resolve(tx.unsafe("select count(*)::int as n from public.learning_results")));
    const readB = await asAuthenticated(admin, B, tx => Promise.resolve(tx.unsafe("select count(*)::int as n from public.learning_results")));
    assertEqual(readA[0]?.n, 10, "owner A ledger RLS");
    assertEqual(readB[0]?.n, 0, "owner B ledger RLS");
    console.log("PASS 07: Real authenticated RLS reads are owner-scoped after cutover.");

    // This is not a fully secure mastery boundary. Explicitly verify it is still open.
    const manual = await asAuthenticated(admin, A, tx => Promise.resolve(tx.unsafe(
      "update public.words set score=100 where id=$1::uuid returning score", [ONE_WORD])));
    assertEqual(manual[0]?.score, 100, "legacy manual word score editing");
    console.log("KNOWN GAP: authenticated owner can still set words.score=100 manually (library groups depend on it).");
    console.log("PASS: V5C-D REAL POSTGRES CUTOVER REHEARSAL COMPLETE. NO REMOTE DATABASE TOUCHED.");
  } finally {
    await Promise.allSettled([admin.close(), service.close()]);
  }
}
await main().catch((error) => {
  // Do not echo connection values or secret strings.
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : "V5C-D isolated test failed");
  process.exitCode = 1;
});
