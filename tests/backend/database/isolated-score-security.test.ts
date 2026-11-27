import { expect, test } from "bun:test";
import assert from "node:assert/strict";
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
  type OnlineAction,
  type OnlineView,
  type WordEntry,
  wordEntrySchema,
} from "../../../packages/shared/src/index";
import { loopbackPort } from "../../../scripts/quality/browser-config";
import { verifyDevices } from "./browser-devices";
import { verifyControlCenter } from "./control-center-acceptance";

const host = "127.0.0.1";
const rest = `http://127.0.0.1:${loopbackPort("ATLAS_ISOLATED_REST_PORT", 55421)}`;
const auth = `http://127.0.0.1:${loopbackPort("ATLAS_ISOLATED_AUTH_PORT", 55429)}`;
const dbPort = String(loopbackPort("ATLAS_ISOLATED_DB_PORT", 55422));
const adminUrl = process.env.ATLAS_ISOLATED_TEST_ADMIN_URL;
const writerUrl = process.env.ATLAS_ISOLATED_TEST_WRITER_URL;
function localDatabase(url: string, role: string) {
  const parsed = new URL(url);
  if (
    parsed.hostname !== host ||
    parsed.port !== dbPort ||
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
  const credentials = {
    email: "score-" + crypto.randomUUID() + "@atlas-test.invalid",
    password: "AtlasSynthetic!" + crypto.randomUUID(),
  };
  const response = await fetch(auth + "/signup", json("POST", credentials));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.user.role).toBe("authenticated");
  return {
    credentials,
    id: body.user.id as string,
    token: body.access_token as string,
    secondSession: async () => {
      const response = await fetch(auth + "/token?grant_type=password", json("POST", credentials));
      expect(response.status).toBe(200);
      return (await response.json()) as { access_token: string; refresh_token: string };
    },
  };
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
      idleTimeout: 30,
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
        const headers = new Headers(request.headers);
        headers.set("connection", "close");
        return fetch(service + path + url.search, {
          method: request.method,
          headers,
          signal: AbortSignal.timeout(15000),
          body: request.body,
          redirect: "error",
        });
      },
    });
    const assessmentWriter = createAssessmentWriter(serviceUrl);
    const app = createApp(
      readConfig({
        APP_ORIGINS: `http://127.0.0.1:${loopbackPort("ATLAS_ISOLATED_WEB_PORT", 5178)}`,
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
      expect(await (await api("/api/ready", {})).json()).toEqual({ status: "ready" });
      const [a, b] = await Promise.all([localAccount(), localAccount()]);
      const serviceKey = process.env.ATLAS_ISOLATED_SERVICE_KEY;
      if (!serviceKey) throw new Error("Synthetic service key required");
      await verifyControlCenter(gateway.url.href, a, b, serviceKey);
      if (process.env.ATLAS_ISOLATED_WEB_BUILD) {
        const learner = await localAccount();
        const practice = Array.from({ length: 20 }, (_, index) => {
          const word = "Atlasword" + String.fromCharCode(97 + index);
          const meaning = "Sentetik anlam " + index;
          return {
            word,
            meaning,
            input: {
              meanings: [meaning],
              partOfSpeech: "Noun",
              cefr: "B2",
              usageNote: "Sentetik çalışma.",
              examples: Array.from({ length: 5 }, (_, example) => ({
                sentence: `Marker ${index} shows ${word} in sentence ${example}.`,
                translation: `${meaning} örneği ${example}.`,
                difficulty: ["easy", "easy", "medium", "yds", "yds"][example],
                translationFocus: [meaning],
              })),
            },
          };
        });
        for (const row of practice) {
          await pg`insert into public.words(user_id,word,content) values(${learner.id}::uuid,${row.word},${row.input}::jsonb)`;
        }
        const sessionId = await verifyDevices(
          process.env.ATLAS_ISOLATED_WEB_BUILD,
          gateway.url.href,
          app,
          learner.credentials,
          learner.id,
          practice.map(({ word, meaning }) => ({ word, meaning })),
        );
        const [record] = await pg`
          select l.scores, s.completed_at is not null as finished, s.snapshot->>'saved' as saved,
            (select count(*)::int from public.words where user_id=${learner.id}::uuid and score=100) as graded,
            (select count(*)::int from public.daily_word_completions where user_id=${learner.id}::uuid) as progress,
            (select count(*)::int from public.completed_goal_days where user_id=${learner.id}::uuid and goal=20) as goals
          from public.learning_results l join public.learning_sessions s on s.id=l.session_id
          where l.session_id=${sessionId}::uuid and l.user_id=${learner.id}::uuid`;
        expect(record).toMatchObject({
          finished: true,
          saved: "true",
          graded: 20,
          progress: 20,
          goals: 1,
        });
        expect(record.scores).toHaveLength(20);
        expect(record.scores.every(({ score }: { score: number }) => score === 100)).toBe(true);
        console.log(
          "PASS Chromium 20 words, four groups, all assessment stages and PostgreSQL result/history/goal",
        );
      }
      const suffix = crypto.randomUUID().slice(0, 8);
      function input(name: string) {
        const word = name + suffix;
        return {
          word,
          meanings: ["sentetik anlam " + name],
          usageNote: "İlk sentetik not",
          score: 99,
          examples: Array.from({ length: 5 }, (_, i) => ({
            sentence: "Marker " + name + " uses " + word + " in example " + i + ".",
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
      const legacyFinished = await finish(picked.id, revision);
      expect(legacyFinished.status).toBe(200);
      expect(await legacyFinished.json()).toEqual({ scores: [], practiceOnly: true });

      check = "private online assessment, reconnect and atomic completion";
      const root = "/api/learning/online";
      const revised = await create("Revise", a.token);
      const removed = await create("Remove", a.token);
      const candidates = [secondTab, revised, removed];
      const startBody = {
        command: crypto.randomUUID(),
        words: candidates.map(({ id }) => id),
        batchSize: 5,
      };
      expect(
        (await api(root, json("POST", { ...startBody, words: [other.id] }, a.token))).status,
      ).toBe(404);
      const opening = await api(root, json("POST", startBody, a.token));
      expect(opening.status).toBe(200);
      let view: OnlineView = await opening.json();
      const route = root + "/" + view.id;
      expect((await api(route, json("GET", undefined, b.token))).status).toBe(404);
      const device = (await a.secondSession()).access_token;
      const resume = await api(root, json("GET", undefined, device));
      expect(await resume.json()).toEqual({ current: view });
      const replayStart = await api(root, json("POST", startBody, a.token));
      expect(await replayStart.json()).toEqual(view);
      expect(
        (await fetch(rest + "/rpc/atlas_online_assessment_active", json("POST", {}, a.token)))
          .status,
      ).toBe(200);
      const [beforeRevision] =
        await pg`select updated_at::text as value from public.words where id=${revised.id}::uuid`;
      expect(
        (
          await api(
            "/api/words/" + revised.id,
            json("PATCH", { usageNote: "Edited from the other device" }, device, revised.updatedAt),
          )
        ).status,
      ).toBe(200);
      expect(
        (await api("/api/words/" + removed.id, json("DELETE", undefined, device))).status,
      ).toBe(200);
      const [afterRevision] =
        await pg`select updated_at::text as value from public.words where id=${revised.id}::uuid`;
      expect(afterRevision.value).not.toBe(beforeRevision.value);
      for (let step = 0; view.status === "active" && step < 60; step += 1) {
        for (const field of [
          "words",
          "state",
          "queue",
          "assessment",
          "correct",
          "answer",
          "seed",
        ]) {
          expect(view).not.toHaveProperty(field);
        }
        let action: OnlineAction;
        if (view.confidence) action = { kind: "confidence", value: 0 };
        else if (view.next) action = { kind: "next" };
        else {
          const selected = view.choices?.find((entry) => entry.side === "left" && entry.selected);
          const contextual = view.phase.endsWith("context");
          const prompt = view.prompt;
          if (contextual) assert(prompt);
          const correct = view.phase.endsWith("matching")
            ? candidates.find((entry) => entry.word === selected?.text)?.meanings[0]
            : contextual
              ? candidates.find((entry) => entry.word.startsWith(prompt?.split(" ")[1] ?? ""))?.word
              : candidates.find((entry) => entry.word === view.prompt)?.meanings[0];
          const choice = view.choices?.find((item) =>
            view.phase.endsWith("matching") && !selected
              ? item.side === "left" && !item.matched
              : item.text === correct,
          );
          if (!choice) throw new Error("Missing synthetic assessment option for " + view.phase);
          action = { kind: "choose", token: choice.token };
        }
        const command = { command: crypto.randomUUID(), revision: view.revision, action };
        if (view.phase === "final-context" && view.done === 2 && action.kind === "next") {
          await pg.unsafe(
            "create function public.atlas_test_abort_result() returns trigger language plpgsql as $$ begin raise exception 'synthetic write failure'; end; $$",
          );
          try {
            await pg.unsafe(
              "create trigger atlas_test_abort_result before insert on public.learning_results for each row execute function public.atlas_test_abort_result()",
            );
            expect((await api(route, json("POST", command, a.token))).status).toBe(503);
          } finally {
            await pg.unsafe(
              "drop trigger if exists atlas_test_abort_result on public.learning_results",
            );
            await pg.unsafe("drop function public.atlas_test_abort_result()");
          }
          const same = await api(route, json("GET", undefined, device));
          expect(await same.json()).toEqual(view);
          const results = await Promise.all(
            [a.token, device].map((token) => api(route, json("POST", command, token))),
          );
          for (const result of results) {
            expect(result.status).toBe(200);
            const finished: OnlineView = await result.json();
            expect(finished.status).toBe("complete");
            const grades = new Map(finished.results?.map((entry) => [entry.word, entry.score]));
            expect(grades.get(secondTab.word)).toBe(88);
            expect(grades.get(revised.word)).toBeNull();
            expect(grades.get(removed.word)).toBeNull();
            view = finished;
          }
        } else {
          const result = await api(route, json("POST", command, a.token));
          if (result.status !== 200)
            throw new Error("Assessment step " + view.phase + ": " + (await result.text()));
          view = await result.json();
          const stale = { ...command, command: crypto.randomUUID() };
          expect((await api(route, json("POST", stale, device))).status).toBe(409);
        }
      }
      expect(view.status).toBe("complete");
      const [count] = await pg`
        select (select count(*)::int from public.learning_results where session_id=${view.id}::uuid) results,
        (select count(*)::int from public.daily_word_completions where user_id=${a.id}::uuid) progress`;
      expect(count).toEqual({ results: 1, progress: 1 });
      console.log(
        "PASS private online questions, second-device reconnect, rollback and idempotent completion",
      );

      const replayed = await api(route, json("GET", undefined, device));
      expect(await replayed.json()).toEqual(view);
      const [wordAfter] =
        await pg`select score,content->>'usageNote' as note from public.words where id=${revised.id}::uuid`;
      expect(wordAfter).toEqual({ score: 0, note: "Edited from the other device" });
      const [written] =
        await pg`select scores from public.learning_results where session_id=${view.id}::uuid`;
      expect(written.scores).toEqual([{ id: first.id, score: 88 }]);
      expect(
        (await api("/api/words/" + revised.id, json("DELETE", undefined, device))).status,
      ).toBe(200);

      check = "online cancellation and expiry";
      const additional = await create("Resume", a.token);
      const begin = () =>
        api(
          root,
          json(
            "POST",
            { ...startBody, words: [additional.id], command: crypto.randomUUID() },
            device,
          ),
        );
      const active = await begin();
      expect(active.status).toBe(200);
      const run: OnlineView = await active.json();
      const cancelPath = root + "/" + run.id;
      const cancelBody = {
        command: crypto.randomUUID(),
        revision: run.revision,
        action: { kind: "cancel" },
      };
      const cancel = await api(cancelPath, json("POST", cancelBody, device));
      expect(cancel.status).toBe(200);
      const cancelled = await cancel.json();
      expect(cancelled.status).toBe("cancelled");
      expect(await (await api(cancelPath, json("POST", cancelBody, a.token))).json()).toEqual(
        cancelled,
      );
      const newRun: OnlineView = await (await begin()).json();
      await pg`update atlas_account.online_assessments set expires_at=now()-interval '1 second' where id=${newRun.id}::uuid`;
      const expired = await api(
        root + "/" + newRun.id,
        json(
          "POST",
          { ...cancelBody, command: crypto.randomUUID(), action: { kind: "next" } },
          device,
        ),
      );
      expect(expired.status).toBe(200);
      expect((await expired.json()).status).toBe("expired");
      expect(await (await api(root, json("GET", undefined, a.token))).json()).toEqual({
        current: null,
      });
      const [remaining] = await pg`select score from public.words where id=${additional.id}::uuid`;
      expect(remaining.score).toBe(0);
      expect(
        (await api("/api/words/" + additional.id, json("DELETE", undefined, a.token))).status,
      ).toBe(200);

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

      check = "account plan, export, deletion gate and session invalidation";
      await pg`insert into public.words(user_id,word) select ${a.id}::uuid,'Library-'||i from generate_series(1,1201)i`;
      const libraryStarted = performance.now();
      const library = await api("/api/words", json("GET", undefined, a.token));
      expect(library.status).toBe(200);
      const entries = wordEntrySchema.array().parse(await library.json());
      expect(entries.length).toBeGreaterThan(1201);
      expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
      console.log(
        "LOCAL library load",
        entries.length,
        "rows",
        Math.round(performance.now() - libraryStarted),
        "ms",
      );
      const excluded = entries.find((entry) => entry.id !== first.id);
      assert(excluded);
      const plan = {
        size: 30,
        groups: [{ day: 60, words: [first.id] }],
        exclusions: [excluded.id],
      };
      const command = { owner: a.id, command: crypto.randomUUID(), revision: 0, plan };
      const replace = (cmd: typeof command) => api("/api/account/plan", json("PUT", cmd, a.token));
      const races = await Promise.all([
        replace(command),
        replace({ ...command, command: crypto.randomUUID(), plan: { ...plan, size: 20 } }),
      ]);
      expect(races.map((r) => r.status).sort()).toEqual([200, 409]);
      const success = races.find((r) => r.status === 200);
      assert(success);
      const winner = await success.json();
      const toDay = {
        owner: a.id,
        command: crypto.randomUUID(),
        revision: 1,
        plan: winner.plan,
        day: 60,
        words: [input("Atomic")],
      };
      for (let i = 0; i < 2; i++) {
        const result = await api("/api/account/plan/import", json("POST", toDay, a.token));
        expect(result.status).toBe(200);
        expect(await result.json()).toMatchObject({ revision: 2, added: 1, duplicates: 0 });
      }
      const confirm = { owner: a.id, confirm: true };
      const exported = await api("/api/account/export", json("POST", confirm, a.token));
      expect(exported.status).toBe(200);
      expect(await exported.json()).toMatchObject({
        format: 1,
        owner: a.id,
        counts: { words: entries.length + 1, plan: 1 },
      });
      expect((await api("/api/account/export", json("POST", confirm, b.token))).status).toBe(403);
      expect((await api("/api/account/delete", json("POST", confirm, a.token))).status).toBe(503);
      // The old array endpoint has a finite transport budget. A modern client can still page.
      await pg`insert into public.words(user_id,word) select ${a.id}::uuid,'Bound-'||i from generate_series(1,20001)i`;
      expect((await api("/api/words", json("GET", undefined, a.token))).status).toBe(413);
      const firstPage = await (
        await api("/api/words/page", json("POST", { cursor: null }, a.token))
      ).json();
      expect(firstPage.words).toHaveLength(128);
      expect(firstPage.total).toBeGreaterThan(20000);
      const nextPage = await (
        await api("/api/words/page", json("POST", { cursor: firstPage.cursor }, a.token))
      ).json();
      expect(nextPage.revision).toBe(firstPage.revision);
      expect(new Set([...firstPage.words, ...nextPage.words].map((row) => row.id)).size).toBe(256);
      expect(
        (await api("/api/words/page", json("POST", { cursor: firstPage.cursor }, b.token))).status,
      ).toBe(403);
      const secondSession = await a.secondSession();
      expect(
        (await api("/api/account/plan", json("GET", undefined, secondSession.access_token))).status,
      ).toBe(200);
      expect((await api("/api/account/revoke", json("POST", confirm, a.token))).status).toBe(200);
      expect(
        (await api("/api/account/plan", json("GET", undefined, secondSession.access_token))).status,
      ).toBe(401);
      expect(
        (
          await fetch(
            auth + "/token?grant_type=refresh_token",
            json("POST", { refresh_token: secondSession.refresh_token }),
          )
        ).ok,
      ).toBe(false);
      expect((await api("/api/words", json("GET", undefined, a.token))).status).toBe(401);
      for (const token of [a.token, secondSession.access_token]) {
        expect((await fetch(rest + "/words", json("GET", undefined, token))).status).toBe(401);
        expect((await fetch(rest + "/rpc/atlas_read_plan", json("POST", {}, token))).status).toBe(
          401,
        );
      }
      expect((await api("/api/words", json("GET", undefined, b.token))).status).toBe(200);
      console.log(
        "PASS large library, plan CAS and replay, owner export, disabled deletion, revoked bearer and second-account isolation",
      );
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
  240_000,
);
