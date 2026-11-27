import { expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { createApp } from "../../../backend/src/app";
import { readConfig } from "../../../backend/src/config/env";
import type { AssessmentWriter } from "../../../backend/src/features/learning/assessment-writer";
import { HttpError } from "../../../backend/src/shared/errors";
import { userClient } from "../../../backend/src/shared/supabase";
import { gameSessionSchema } from "../../../packages/shared/src/index";

const userId = "11111111-1111-4111-8111-111111111111";
const wordId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const timestamp = "2026-11-01T00:00:00.000Z";
const token = "test-learning-session";
const config = readConfig({
  SUPABASE_URL: "https://learning.test.invalid",
  SUPABASE_PUBLISHABLE_KEY: "test-public",
});
const snapshot = gameSessionSchema.parse({
  version: 3,
  id: sessionId,
  words: [{ id: wordId, word: "Evidence", score: 75, createdAt: timestamp, updatedAt: timestamp }],
  batchSize: 5,
  groupIndex: 0,
  phase: "complete",
  queue: [],
  stageCompleted: 1,
  attempts: {},
  scoreChanges: {},
  answer: null,
  finalCorrect: 2,
  finalTotal: 2,
  tutorial: false,
  saved: false,
});

function app(writer: Partial<AssessmentWriter> = {}) {
  const unexpected = async () => {
    throw new Error("Unexpected privileged call");
  };
  return createApp(config, {
    authenticate: async () => ({ userId, db: userClient(config, token) }),
    assessmentWriter: { save: unexpected, complete: unexpected, ...writer },
  });
}

function request(path: string, method: string, body: unknown) {
  return new Request("http://127.0.0.1/api/learning/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockFetch(implementation: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(implementation, { preconnect: globalThis.fetch.preconnect }),
  );
}

function emptyHistory() {
  return Response.json([], { headers: { "Content-Range": "*/0" } });
}

test("account reads preserve an existing goal and use 20 only for an empty profile result", async () => {
  let profile: { daily_goal: number }[] = [];
  const profileMethods: string[] = [];
  let goalWrites = 0;
  const fetch = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer " + token);
    if (url.pathname === "/rest/v1/rpc/set_daily_goal") {
      expect(method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ p_goal: 50 });
      goalWrites++;
      profile = [{ daily_goal: 50 }];
      return Response.json(50);
    }
    expect(method).toBe("GET");
    if (url.pathname !== "/rest/v1/profiles") return emptyHistory();
    profileMethods.push(method);
    expect(url.searchParams.get("user_id")).toBe("eq." + userId);
    return Response.json(profile);
  });
  try {
    const handler = app();
    const read = async (dailyGoal: number) => {
      const response = await handler(new Request("http://127.0.0.1/api/account"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        onlineProtocol: 1,
        planProtocol: 1,
        dailyGoal,
        session: null,
        progress: [],
        completedDays: [],
      });
    };
    await read(20);
    await read(20);
    expect(profile).toEqual([]);
    expect(goalWrites).toBe(0);
    const update = await handler(
      new Request("http://127.0.0.1/api/account/goal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: 50 }),
      }),
    );
    expect(update.status).toBe(200);
    expect(goalWrites).toBe(1);
    await read(50);
    expect(profileMethods).toEqual(["GET", "GET", "GET"]);
  } finally {
    fetch.mockRestore();
  }
});

test("a closed session on a second device does not hide an earlier unfinished session", async () => {
  let unfinished = true;
  const active = { ...snapshot, id: crypto.randomUUID(), phase: "flashcards", queue: [wordId] };
  const fetch = mockFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname !== "/rest/v1/learning_sessions") return emptyHistory();
    expect(url.searchParams.get("user_id")).toBe("eq." + userId);
    expect(url.searchParams.get("order")).toBe("updated_at.desc,id.asc");
    if (url.searchParams.get("completed_at") === "is.null") {
      expect(url.searchParams.get("or")).toBe(
        "(snapshot->>discarded.is.null,snapshot->>discarded.neq.true)",
      );
      return Response.json(
        unfinished
          ? [{ snapshot: active, revision: 2, assessment_protocol: null, completed_at: null }]
          : [],
      );
    }
    return Response.json([
      {
        snapshot: { ...snapshot, saved: true },
        revision: 4,
        assessment_protocol: null,
        completed_at: timestamp,
      },
    ]);
  });
  try {
    const read = () => app()(new Request("http://127.0.0.1/api/account"));
    const resumed = await read();
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).session).toMatchObject({
      snapshot: { id: active.id },
      revision: 2,
    });
    unfinished = false;
    expect((await (await read()).json()).session).toMatchObject({
      snapshot: { id: snapshot.id, saved: true },
      revision: 4,
    });
  } finally {
    fetch.mockRestore();
  }
});

test("goal saves require the requested value in the database acknowledgement", async () => {
  let received: unknown = null;
  const fetch = mockFetch(async () => Response.json(received));
  try {
    for (const value of [null, 40, "50", 50]) {
      received = value;
      const response = await app()(
        new Request("http://127.0.0.1/api/account/goal", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal: 50 }),
        }),
      );
      expect(response.status).toBe(value === 50 ? 200 : 503);
      expect(await response.json()).toMatchObject(
        value === 50 ? { goal: 50 } : { code: "GOAL_UNCONFIRMED" },
      );
    }
  } finally {
    fetch.mockRestore();
  }
});

test("an unreadable saved session prevents bootstrap from returning an empty or corrupt cache", async () => {
  let received: unknown;
  const fetch = mockFetch(async (input) =>
    new URL(String(input)).pathname.endsWith("/learning_sessions")
      ? Response.json(received)
      : emptyHistory(),
  );
  try {
    const valid = { snapshot, revision: 3, assessment_protocol: null, completed_at: null };
    for (const unreadable of [
      null,
      [null],
      [{ ...valid, snapshot: null }],
      [{ ...valid, revision: 0 }],
      [{ ...valid, assessment_protocol: 2 }],
    ]) {
      received = unreadable;
      const response = await app()(new Request("http://127.0.0.1/api/account"));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "SESSION_NOT_AVAILABLE" });
    }
  } finally {
    fetch.mockRestore();
  }
});

test("account exports verify all eight row counts before returning a download", async () => {
  const data = {
    profile: [],
    words: [{ word: "example" }],
    sessions: [],
    results: [],
    wordCompletions: [],
    goalDays: [],
    usage: [],
    plan: [],
  };
  const counts = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
  const archive = { owner: userId, format: 1, at: timestamp, data, counts };
  let received: unknown;
  const fetch = mockFetch(async (input) =>
    Response.json(
      new URL(String(input)).pathname.endsWith("/atlas_confirm_account") ? true : received,
    ),
  );
  try {
    const handler = app();
    const download = () =>
      handler(
        new Request("http://127.0.0.1/api/account/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner: userId, confirm: true }),
        }),
      );
    for (const malformed of [
      { ...archive, data: { ...data, words: [] } },
      { ...archive, data: { ...data, plan: undefined } },
      { ...archive, counts: { ...counts, sessions: undefined } },
      { ...archive, format: 2 },
    ]) {
      received = malformed;
      const response = await download();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "EXPORT_INCOMPLETE" });
    }
    received = archive;
    const response = await download();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(archive);
  } finally {
    fetch.mockRestore();
  }
});

for (const [failure, status, code, respond] of [
  [
    "network",
    503,
    "DATABASE_UNAVAILABLE",
    () => {
      throw new TypeError("Network failed");
    },
  ],
  ["permission", 403, "FORBIDDEN", () => Response.json({ code: "42501" }, { status: 403 })],
  [
    "database",
    503,
    "DATABASE_UNAVAILABLE",
    () => Response.json({ code: "XX000" }, { status: 500 }),
  ],
  ["null response", 503, "PROFILE_NOT_AVAILABLE", () => Response.json(null)],
  ["invalid goal", 503, "PROFILE_NOT_AVAILABLE", () => Response.json([{ daily_goal: 55 }])],
  [
    "multiple rows",
    503,
    "PROFILE_NOT_AVAILABLE",
    () => Response.json([{ daily_goal: 50 }, { daily_goal: 60 }]),
  ],
] as const) {
  test(`account profile ${failure} remains an error until a successful retry`, async () => {
    let failing = true;
    const fetch = mockFetch(async (input, init) => {
      expect(init?.method ?? "GET").toBe("GET");
      if (new URL(String(input)).pathname !== "/rest/v1/profiles") return emptyHistory();
      return failing ? respond() : Response.json([{ daily_goal: 70 }]);
    });
    try {
      const handler = app();
      const read = () => handler(new Request("http://127.0.0.1/api/account"));
      const failed = await read();
      expect(failed.status).toBe(status);
      expect(await failed.json()).toMatchObject({ code });
      failing = false;
      const retry = await read();
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ dailyGoal: 70 });
    } finally {
      fetch.mockRestore();
    }
  }, 15_000); // Allow the PostgREST client to exhaust its network retries.
}

test("account history reads every entry below the service row cap and confirms the final count", async () => {
  const rows = Array.from({ length: 1537 }, (_, index) => ({
    day: "2026-11-01",
    word_id: `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`,
  }));
  let offset = 0,
    checks = 0;
  const fetch = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname !== "/rest/v1/daily_word_completions") return emptyHistory();
    expect(url.searchParams.get("user_id")).toBe("eq." + userId);
    const headers = { "Content-Range": `*/${rows.length}` };
    if (init?.method === "HEAD") {
      checks++;
      return new Response(null, { headers });
    }
    const previous = rows[offset - 1];
    if (offset) assert(previous);
    expect(url.searchParams.get("or")).toBe(
      previous ? `(day.lt.2026-11-01,and(day.eq.2026-11-01,word_id.gt.${previous.word_id}))` : null,
    );
    const page = rows.slice(offset, offset + 193);
    offset += page.length;
    return Response.json(page, { headers });
  });
  try {
    const response = await app()(new Request("http://127.0.0.1/api/account"));
    expect(response.status).toBe(200);
    expect((await response.json()).progress).toEqual(rows);
    expect(checks).toBe(1);
  } finally {
    fetch.mockRestore();
  }
});

for (const issue of [
  "null",
  "missing count",
  "short",
  "duplicate",
  "changed count",
  "over limit",
] as const) {
  test(`account bootstrap refuses incomplete learning history (${issue})`, async () => {
    const fetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname !== "/rest/v1/completed_goal_days") return emptyHistory();
      const headers = { "Content-Range": "*/2" };
      const first = { day: "2026-11-01", goal: 20 };
      if (issue === "null") return Response.json(null, { headers: { "Content-Range": "*/0" } });
      if (issue === "missing count") return Response.json([]);
      if (issue === "over limit")
        return Response.json([], { headers: { "Content-Range": "*/250001" } });
      if (issue === "short") return Response.json([], { headers });
      if (issue === "duplicate") return Response.json([first, first], { headers });
      if (init?.method === "HEAD")
        return new Response(null, { headers: { "Content-Range": "*/3" } });
      return Response.json(
        [url.searchParams.has("day") ? { day: "2026-10-31", goal: 30 } : first],
        { headers },
      );
    });
    try {
      const response = await app()(new Request("http://127.0.0.1/api/account"));
      expect(response.status).toBe(issue === "over limit" ? 413 : 503);
      expect(await response.json()).toMatchObject({
        code: issue === "over limit" ? "HISTORY_LIMIT" : "INCOMPLETE_HISTORY",
      });
    } finally {
      fetch.mockRestore();
    }
  });
}

test("completion rejects a client score, a forged owner and old requests with no revision", async () => {
  const handler = app();
  const path = "sessions/" + sessionId + "/complete";
  expect(
    (await handler(request(path, "POST", { revision: 3, scores: [{ id: wordId, score: 100 }] })))
      .status,
  ).toBe(400);
  expect((await handler(request(path, "POST", { revision: 3, userId: wordId }))).status).toBe(400);
  const upgrade = await handler(request(path, "POST", {}));
  expect(upgrade.status).toBe(409);
  expect(await upgrade.json()).toMatchObject({ code: "ASSESSMENT_UPGRADE_REQUIRED" });
});

test("completion forwards only authenticated owner, session and expected revision", async () => {
  const commands: unknown[][] = [];
  const handler = app({
    async complete(...params) {
      commands.push(params);
      throw new HttpError(404, "Görev bulunamadı.", "NOT_FOUND");
    },
  });
  const response = await handler(
    request("sessions/" + sessionId + "/complete", "POST", { revision: 3 }),
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  expect(commands).toEqual([[userId, sessionId, 3]]);
});

test("saving a stale session revision never calls the assessment writer", async () => {
  const fetch = mockFetch(async (input, init) => {
    expect(new URL(String(input)).pathname).toBe("/rest/v1/learning_sessions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer " + token);
    return Response.json([
      { snapshot, revision: 4, assessment_protocol: null, completed_at: null },
    ]);
  });
  try {
    const response = await app()(request("session", "PUT", { snapshot, revision: 3 }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "SESSION_CONFLICT" });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    fetch.mockRestore();
  }
});

test("discarding an unregistered draft does not start an assessment or write it", async () => {
  const fetch = mockFetch(async () => Response.json([]));
  try {
    const response = await app()(
      request("session", "PUT", {
        snapshot: { ...snapshot, discarded: true, assessmentActions: [{ type: "advance" }] },
        revision: 0,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    fetch.mockRestore();
  }
});
