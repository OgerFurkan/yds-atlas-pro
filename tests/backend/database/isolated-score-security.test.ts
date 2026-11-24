import { expect, test } from "bun:test";
import { SQL } from "bun";
import { createApp } from "../../../backend/src/app";
import { readConfig } from "../../../backend/src/config/env";
import { createAssessmentWriter } from "../../../backend/src/features/learning/assessment-writer";
import {
  applyAssessmentAction,
  createAssessmentSnapshot,
  makeQuestion,
} from "../../../packages/shared/src/game-engine";
import {
  type AssessmentAction,
  type GameSession,
  type WordEntry,
  wordEntrySchema,
} from "../../../packages/shared/src/index";

const host = "127.0.0.1";
const rest = "http://127.0.0.1:55421";
const auth = "http://127.0.0.1:55429";
const adminUrl = process.env.ATLAS_ISOLATED_TEST_ADMIN_URL;
const writerUrl = process.env.ATLAS_ISOLATED_TEST_WRITER_URL;
function localDatabase(url: string, role: string) {
  const parsed = new URL(url);
  if (
    parsed.hostname !== host ||
    parsed.port !== "55422" ||
    parsed.pathname !== "/postgres" ||
    parsed.username !== role ||
    !["postgresql:", "postgres:"].includes(parsed.protocol)
  )
    throw new Error("The score security test requires its isolated loopback database.");
  return url;
}

function json(method: string, body: unknown, token?: string, revision?: string): RequestInit {
  return {
    method,
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(revision ? { "X-Atlas-Expected-Updated-At": revision } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function localAccount() {
  const response = await fetch(
    auth + "/signup",
    json("POST", {
      email: "score-" + crypto.randomUUID() + "@atlas-test.invalid",
      password: "AtlasSynthetic!" + crypto.randomUUID(),
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.user.role).toBe("authenticated");
  return { id: body.user.id as string, token: body.access_token as string };
}

function played(snapshot: GameSession): GameSession {
  let current = snapshot;
  const actions: AssessmentAction[] = [];
  while (current.phase !== "complete") {
    let action: AssessmentAction;
    if (current.phase === "flashcards") action = { type: "advance" };
    else if (current.matching) {
      const board = current.matching;
      const id = board.left.find((item) => !board.matched.includes(item));
      action = !id
        ? { type: "match-next" }
        : { type: "match", side: board.selectedLeft ? "right" : "left", id };
    } else if (!current.answer) {
      const quiz = makeQuestion(current);
      if (!quiz) throw new Error("Expected an active question");
      action = { type: "answer", choice: quiz.correct };
    } else if (current.phase.startsWith("final-") && current.answer.confidence === null) {
      action = { type: "confidence", value: 0 };
    } else action = { type: "advance" };
    const next = applyAssessmentAction(current, action);
    if (next === current || actions.length > 100) throw new Error("Invalid test action");
    actions.push(action);
    current = next;
  }
  return { ...current, assessmentActions: actions };
}

test.skipIf(!adminUrl || !writerUrl)(
  "isolated Supabase Auth, PostgREST, and independent PostgreSQL connections enforce score authority",
  async () => {
    if (!adminUrl || !writerUrl) throw new Error("Expected isolated test credentials");
    const options = { max: 1, connectionTimeout: 5 };
    const pg = new SQL(localDatabase(adminUrl, "supabase_admin"), options);
    const serviceUrl = localDatabase(writerUrl, "atlas_assessment_api");
    const writerA = new SQL(serviceUrl, options);
    const writerB = new SQL(serviceUrl, options);
    const gateway = Bun.serve({
      hostname: host,
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const service = url.pathname.startsWith("/auth/v1/")
          ? auth
          : url.pathname.startsWith("/rest/v1/")
            ? rest
            : null;
        if (!service) return new Response(null, { status: 404 });
        const path = url.pathname.replace(/^\/(auth|rest)\/v1/, "");
        return fetch(service + path + url.search, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: "error",
        });
      },
    });
    const assessmentWriter = createAssessmentWriter(serviceUrl);
    const app = createApp(
      readConfig({
        SUPABASE_URL: gateway.url.href,
        SUPABASE_PUBLISHABLE_KEY: "isolated-test-only",
        SUPABASE_ASSESSMENT_DATABASE_URL: serviceUrl,
      }),
      { assessmentWriter },
    );
    function api(path: string, init: RequestInit) {
      return app(new Request("http://127.0.0.1" + path, init));
    }
    let check = "Auth and application word routes";
    try {
      const [a, b] = await Promise.all([localAccount(), localAccount()]);
      const suffix = crypto.randomUUID().slice(0, 8);
      function input(name: string) {
        const word = name + suffix;
        return {
          word,
          meanings: ["sentetik anlam " + name],
          usageNote: "İlk sentetik not",
          score: 99,
          examples: Array.from({ length: 5 }, (_, i) => ({
            sentence: "We use " + word + " in example " + i + ".",
            translation: "Sentetik çeviri.",
          })),
        };
      }
      async function create(name: string, token: string) {
        const response = await api(
          "/api/words",
          json("POST", { ...input(name), srs: { interval: 12 } }, token),
        );
        expect(response.status).toBe(200);
        const word = wordEntrySchema.parse(await response.json());
        expect(word.score).toBe(0);
        return word;
      }
      const first = await create("Evaluate", a.token);
      const other = await create("Measure", b.token);
      const rows = await pg`select content from public.words where id = ${first.id}::uuid`;
      expect(rows[0].content).not.toHaveProperty("srs");
      expect(rows[0].content).not.toHaveProperty("score");
      expect(
        (await api("/api/words/import", json("POST", [input("Import")], a.token))).status,
      ).toBe(200);
      const [imported] =
        await pg`select id,score from public.words where word = ${"Import" + suffix}`;
      expect(imported.score).toBe(0);
      expect(
        (await api("/api/words/scores", json("PUT", [{ id: first.id, score: 100 }], a.token)))
          .status,
      ).toBe(410);
      expect(
        (
          await api(
            "/api/words/" + first.id,
            json("PATCH", { score: 100 }, a.token, first.updatedAt),
          )
        ).status,
      ).toBe(400);
      console.log("PASS forged score API, POST, PATCH, and import");

      check = "PostgREST protected mutations";
      const deniedRequests = [
        ["PATCH", "/words?id=eq." + first.id, { score: 100 }],
        ["PATCH", "/words?id=eq." + first.id, { content: { score: 100 } }],
        ["PATCH", "/words?id=eq." + first.id, { content: { srs: { interval: 999 } } }],
        ["POST", "/words", { word: "Forged", user_id: a.id, score: 100 }],
        ["POST", "/learning_sessions", { id: crypto.randomUUID(), user_id: a.id, snapshot: {} }],
        [
          "POST",
          "/learning_results",
          { session_id: crypto.randomUUID(), user_id: a.id, scores: [] },
        ],
        [
          "POST",
          "/daily_word_completions",
          { user_id: a.id, day: "2026-11-24", word_id: first.id },
        ],
        ["POST", "/completed_goal_days", { user_id: a.id, day: "2026-11-24", goal: 10 }],
        ["POST", "/rpc/apply_word_scores", { p_scores: [{ id: first.id, score: 100 }] }],
        ["POST", "/rpc/complete_learning_session", { p_id: first.id, p_scores: [] }],
        [
          "POST",
          "/rpc/save_learning_session",
          { p_id: first.id, p_snapshot: {}, p_expected_revision: 0 },
        ],
        [
          "POST",
          "/rpc/atlas_finish_learning_session",
          { p_user: a.id, p_id: first.id, p_revision: 1 },
        ],
      ] as const;
      await Promise.all(
        deniedRequests.map(async ([method, path, payload]) => {
          const response = await fetch(rest + path, json(method, payload, a.token));
          expect([401, 403, 404]).toContain(response.status);
        }),
      );
      expect((await fetch(rest + "/words", json("GET", undefined))).ok).toBe(false);
      expect(
        await (
          await fetch(rest + "/words?id=eq." + first.id, json("GET", undefined, b.token))
        ).json(),
      ).toEqual([]);
      check = "independent PostgreSQL writer roles";
      const [identity] = await writerA`select current_user as role, pg_backend_pid() as pid`;
      const [identityB] = await writerB`select current_user as role, pg_backend_pid() as pid`;
      expect(identity.role).toBe("atlas_assessment_api");
      expect(identity.pid).not.toBe(identityB.pid);
      const directWrite = async () =>
        await writerA`update public.words set score=100 where id=${first.id}::uuid`;
      await expect(directWrite()).rejects.toMatchObject({ errno: "42501" });
      console.log(
        "PASS two Auth roles, anonymous, writer least privilege, RLS, direct DML and RPC",
      );

      check = "legitimate word and goal mutations";
      const inputUpdate = { ...input("Evaluate"), usageNote: "İkinci sekmenin notu", score: 100 };
      const updated = await api(
        "/api/words/" + first.id,
        json("PUT", inputUpdate, a.token, first.updatedAt),
      );
      expect(updated.status).toBe(200);
      const secondTab = wordEntrySchema.parse(await updated.json());
      expect(secondTab.score).toBe(0);
      expect((await api("/api/account/goal", json("PUT", { goal: 10 }, a.token))).status).toBe(200);
      expect(
        (await api("/api/words/" + imported.id, json("DELETE", undefined, a.token))).status,
      ).toBe(200);
      console.log("PASS legitimate PUT, delete and daily goal");

      function start(words: WordEntry[]): GameSession {
        return {
          ...createAssessmentSnapshot(words, 5, crypto.randomUUID()),
          assessmentActions: [],
        };
      }
      check = "assessment validation and RLS";
      const picked = start([secondTab]);
      const put = (snapshot: GameSession, revision: number, token = a.token) =>
        api("/api/learning/session", json("PUT", { snapshot, revision }, token));
      const finish = (id: string, revision: number, token = a.token) =>
        api("/api/learning/sessions/" + id + "/complete", json("POST", { revision }, token));
      expect((await put(start([other]), 0)).status).toBe(404);
      expect(
        (
          await put(
            { ...picked, assessmentActions: [{ type: "answer", choice: "wrong phase" }] },
            0,
          )
        ).status,
      ).toBe(400);
      const fake = {
        ...picked,
        phase: "complete" as const,
        queue: [],
        assessment: {
          [first.id]: {
            matchingDone: true,
            matchingErrors: 0,
            meaning: { correct: true, confidence: 20 as const },
            context: { correct: true, confidence: 20 as const },
          },
        },
      };
      const saved = await put(fake, 0);
      expect(saved.status).toBe(200);
      const { revision: started } = await saved.json();
      expect(
        (
          await put(
            { ...picked, assessmentActions: [{ type: "answer", choice: "wrong phase" }] },
            started,
          )
        ).status,
      ).toBe(400);
      expect((await finish(picked.id, started)).status).toBe(400);
      expect((await finish(picked.id, started, b.token)).status).toBe(404);
      console.log("PASS foreign word, foreign session, forged snapshot and out-of-order response");

      check = "stale revision and atomic failure";
      const completed = played(picked);
      const update = await put(completed, started);
      expect(update.status).toBe(200);
      const { revision } = await update.json();
      expect((await finish(picked.id, started)).status).toBe(409);
      await pg.unsafe(
        "create function public.atlas_test_abort_result() returns trigger language plpgsql as $$ begin raise exception 'synthetic write failure'; end; $$",
      );
      try {
        await pg.unsafe(
          "create trigger atlas_test_abort_result before insert on public.learning_results for each row execute function public.atlas_test_abort_result()",
        );
        expect((await finish(picked.id, revision)).status).toBe(503);
      } finally {
        await pg.unsafe(
          "drop trigger if exists atlas_test_abort_result on public.learning_results",
        );
        await pg.unsafe("drop function public.atlas_test_abort_result()");
      }
      const [rolledBack] = await pg`
        select w.score, s.completed_at, s.revision,
          (select count(*)::int from public.daily_word_completions where user_id=${a.id}::uuid) as progress
        from public.words w, public.learning_sessions s where w.id=${first.id}::uuid and s.id=${picked.id}::uuid`;
      expect(rolledBack).toMatchObject({ score: 0, completed_at: null, revision, progress: 0 });
      console.log("PASS stale revision and rollback after a mid-transaction failure");

      check = "concurrent and duplicate completion";
      const results = await Promise.all([
        writerA`select public.atlas_finish_learning_session(${a.id}::uuid, ${picked.id}::uuid, ${revision}::integer) as result`,
        writerB`select public.atlas_finish_learning_session(${a.id}::uuid, ${picked.id}::uuid, ${revision}::integer) as result`,
      ]);
      const expected = { scores: [{ id: first.id, score: 88 }], practiceOnly: false };
      for (const [row] of results) expect(row.result).toEqual(expected);
      const duplicate = await finish(picked.id, revision);
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toEqual(expected);
      const [count] = await pg`
        select (select count(*)::int from public.learning_results where session_id=${picked.id}::uuid) results,
        (select count(*)::int from public.daily_word_completions where user_id=${a.id}::uuid) progress`;
      expect(count).toEqual({ results: 1, progress: 1 });
      console.log("PASS valid score 88, concurrent SQL completion, idempotent HTTP replay");

      check = "concurrent word edit and legacy compatibility";
      const stale = await api(
        "/api/words/" + first.id,
        json(
          "PATCH",
          { examples: [{ sentence: "Changed", translation: "Eski sekme" }] },
          a.token,
          first.updatedAt,
        ),
      );
      expect(stale.status).toBe(409);
      const [preserved] =
        await pg`select score,content from public.words where id = ${first.id}::uuid`;
      expect(preserved).toMatchObject({
        score: 88,
        content: { usageNote: inputUpdate.usageNote, examples: secondTab.examples },
      });
      console.log("PASS two-tab score, note and examples preserved through real SQL");

      for (const version of [2, 3] as const) {
        const legacy = { ...fake, id: crypto.randomUUID(), version, assessmentActions: undefined };
        const old = await put(legacy, 0);
        expect(old.status).toBe(200);
        const { revision: oldRevision } = await old.json();
        const result = await finish(legacy.id, oldRevision);
        expect(result.status).toBe(200);
        expect(await result.json()).toEqual({ scores: [], practiceOnly: true });
      }
      const [afterLegacy] = await pg`select score from public.words where id=${first.id}::uuid`;
      expect(afterLegacy.score).toBe(88);
      console.log("PASS legacy v2 and v3 are practice-only");
    } catch (reason) {
      console.error("Failed isolated acceptance group:", check);
      throw reason;
    } finally {
      gateway.stop(true);
      await Promise.allSettled([
        pg.close({ timeout: 2 }),
        writerA.close({ timeout: 2 }),
        writerB.close({ timeout: 2 }),
        assessmentWriter.close(),
      ]);
    }
  },
  120_000,
);
