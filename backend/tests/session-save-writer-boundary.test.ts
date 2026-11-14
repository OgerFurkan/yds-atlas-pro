import { describe, expect, test } from "bun:test";
import type { GameSession } from "@yds-atlas/shared";
import { createApp } from "../src/app";
import { readConfig } from "../src/config/env";
import { HttpError } from "../src/shared/errors";
import type { RequestContext } from "../src/shared/supabase";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const WORD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function config(enabled?: boolean) {
  return readConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    ...(enabled === undefined ? {} : { SESSION_SAVE_V5_ENABLED: String(enabled) }),
    // Missing service secret is intentional. Tests inject the privileged writer.
  });
}

const session = (): GameSession => ({
  version: 3, groupMatching: true, id: SESSION,
  words: [{
    id: WORD, word: "abandon", alternatives: [], meanings: ["terk etmek"],
    usageNote: "", partOfSpeech: "verb", cefr: "B2", score: 20, senses: [], examples: [],
    pronunciationUk: "", pronunciationUs: "", sourceUrl: "",
    createdAt: "2026-11-14T12:00:00.000Z", updatedAt: "2026-11-14T12:00:00.000Z",
  }],
  batchSize: 5, groupIndex: 0, phase: "complete", queue: [], stageCompleted: 3,
  attempts: {}, scoreChanges: {}, matching: null, answer: null,
  assessment: { [WORD]: {
    matchingDone: true, matchingErrors: 0,
    meaning: { correct: true, confidence: 0 },
    context: { correct: true, confidence: 0 },
  } },
  finalCorrect: 2, finalTotal: 2, tutorial: false, saved: true,
});

type RpcError = { code: string; message?: string };
function harness(opts: {
  enabled?: boolean;
  snapshot?: GameSession;
  revision?: number;
  rpcError?: RpcError;
  result?: unknown;
  injectWriter?: boolean;
} = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let legacyCalls = 0;
  let writerConstructed = 0;
  const jwtCtx = (userId: string): RequestContext => ({
    userId,
    db: {
      async rpc(name: string, args: Record<string, unknown>) {
        if (name !== "save_learning_session") throw new Error("JWT client invoked a private RPC");
        legacyCalls += 1;
        return { data: (args.p_expected_revision as number) + 1, error: null };
      },
    } as unknown as RequestContext["db"],
  });
  const privateWriter = {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== "save_learning_session_v5") throw new Error("Wrong server-only RPC");
      calls.push({ name, args });
      return opts.rpcError
        ? { data: null, error: opts.rpcError }
        : { data: opts.result === undefined ? (args.p_expected_revision as number) + 1 : opts.result, error: null };
    },
    from() { throw new Error("Privileged writer cannot access unrelated tables"); },
  } as unknown as RequestContext["db"];
  const app = createApp(config(opts.enabled), {
    authenticate: async (req) => {
      const auth = req.headers.get("authorization");
      if (auth === "Bearer alice") return jwtCtx(ALICE);
      if (auth === "Bearer bob") return jwtCtx(BOB);
      throw new HttpError(401, "Oturum doğrulanamadı", "UNAUTHENTICATED");
    },
    ...(opts.injectWriter === false ? {} : { sessionSaveWriter: () => {
      writerConstructed += 1;
      return privateWriter;
    } }),
  });
  const request = (who = "alice", revision = opts.revision ?? 0, body?: object) =>
    new Request("http://localhost/api/learning/session", {
      method: "PUT",
      headers: { Authorization: `Bearer ${who}`, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? { snapshot: opts.snapshot ?? session(), revision }),
    });
  return { app, request, calls, get legacyCalls() { return legacyCalls; },
    get writerConstructed() { return writerConstructed; } };
}

describe("Phase 4B v5C-A opt-in server-only session save boundary", () => {
  test("default OFF uses legacy JWT RPC and never creates the server writer", async () => {
    const h = harness();
    expect(config().SESSION_SAVE_V5_ENABLED).toBe(false);
    const res = await h.app(h.request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: 1 });
    expect(h.legacyCalls).toBe(1);
    expect(h.writerConstructed).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  test("explicit OFF still preserves legacy session behavior", async () => {
    const h = harness({ enabled: false, revision: 2 });
    expect((await h.app(h.request())).status).toBe(200);
    expect(h.legacyCalls).toBe(1);
    expect(h.calls).toHaveLength(0);
  });

  test("enabled path calls only service-role v5 RPC with verified owner and CAS", async () => {
    const h = harness({ enabled: true, revision: 5 });
    const res = await h.app(h.request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: 6 });
    expect(h.legacyCalls).toBe(0);
    expect(h.writerConstructed).toBe(1);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.name).toBe("save_learning_session_v5");
    expect(h.calls[0]?.args).toMatchObject({
      p_owner_id: ALICE, p_id: SESSION, p_expected_revision: 5,
      p_snapshot: { id: SESSION, tutorial: false },
    });
  });

  test("client-provided owner header cannot override the verified JWT account", async () => {
    const h = harness({ enabled: true });
    const req = new Request("http://localhost/api/learning/session", {
      method: "PUT", headers: {
        Authorization: "Bearer alice", "Content-Type": "application/json", "x-user-id": BOB,
      }, body: JSON.stringify({ snapshot: session(), revision: 0 }),
    });
    expect((await h.app(req)).status).toBe(200);
    expect(h.calls[0]?.args.p_owner_id).toBe(ALICE);
  });

  test("unauthenticated requests never initialize or call the privileged writer", async () => {
    const h = harness({ enabled: true });
    const res = await h.app(h.request("guest"));
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
    expect(h.writerConstructed).toBe(0);
  });

  test("invalid tutorial snapshots fail before privileged writer creation", async () => {
    const h = harness({ enabled: true, snapshot: { ...session(), tutorial: true } });
    const res = await h.app(h.request());
    expect(res.status).toBe(400);
    expect(h.calls).toHaveLength(0);
    expect(h.writerConstructed).toBe(0);
  });

  test("duplicate word IDs fail before privileged writer creation", async () => {
    const snapshot = session();
    const h = harness({ enabled: true, snapshot: { ...snapshot, words: [...snapshot.words, ...snapshot.words] } });
    const res = await h.app(h.request());
    expect(res.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  test("extra browser owner field is rejected as an invalid request", async () => {
    const h = harness({ enabled: true });
    const res = await h.app(h.request("alice", 0, { snapshot: session(), revision: 0, owner: BOB }));
    expect(res.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  test("revision conflict yields HTTP 409 and never falls back to JWT writing", async () => {
    const h = harness({ enabled: true, rpcError: { code: "40001" } });
    const res = await h.app(h.request());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("SESSION_CONFLICT");
    expect(h.legacyCalls).toBe(0);
    expect(h.calls).toHaveLength(1);
  });

  test("missing service-role secret fails closed (HTTP 503), without JWT fallback", async () => {
    const h = harness({ enabled: true, injectWriter: false });
    const res = await h.app(h.request());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("SESSION_SAVE_WRITER_NOT_CONFIGURED");
    expect(h.legacyCalls).toBe(0);
  });

  test("malformed or stale RPC revisions cannot be returned as success", async () => {
    for (const result of [null, "1", 0, 10, { revision: 1 }, 1.5]) {
      const h = harness({ enabled: true, result });
      const res = await h.app(h.request());
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("SESSION_SAVE_RESULT_INVALID");
    }
  });

  test("service privilege errors never write via the legacy JWT client", async () => {
    const h = harness({ enabled: true, rpcError: { code: "42501" } });
    const res = await h.app(h.request());
    expect(res.status).toBe(403);
    expect(h.legacyCalls).toBe(0);
  });
});
