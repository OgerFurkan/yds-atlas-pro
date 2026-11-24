import { expect, spyOn, test } from "bun:test";
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
