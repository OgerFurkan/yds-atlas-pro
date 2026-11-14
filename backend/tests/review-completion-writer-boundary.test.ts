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
const config = (enabled = true) => readConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable",
  REVIEW_WRITE_V3_ENABLED: String(enabled),
  // Deliberately no secret: tests inject the writer, production must require one.
});

const session = (version: 2 | 3 = 3): GameSession => ({
  version, groupMatching: true, id: SESSION,
  words: [{
    id: WORD, word: "abandon", alternatives: [], meanings: ["terk etmek"],
    usageNote: "", partOfSpeech: "verb", cefr: "B2", score: 20, examples: [],
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

function harness(opts: {
  enabled?: boolean;
  snapshot?: GameSession;
  revision?: number;
  rpcError?: { code: string };
  malformedResult?: boolean;
  injectWriter?: boolean;
} = {}) {
  const current = opts.snapshot ?? session();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let readCount = 0;
  let legacyCalls = 0;
  const jwtCtx = (userId: string): RequestContext => ({
    userId,
    db: {
      from(table: string) {
        if (table !== "learning_sessions") throw new Error("Wrong JWT table");
        return { select(columns: string) {
          if (columns !== "snapshot,revision" && columns !== "snapshot")
            throw new Error("Unexpected columns " + columns);
          let id = "";
          let owner = userId;
          return { eq(column: string, value: string) {
            if (column === "id") id = value;
            else if (column === "user_id") owner = value;
            else throw new Error("Wrong JWT filter");
            return this;
          }, async maybeSingle() {
            readCount += 1;
            return { data: id === SESSION && owner === userId && userId === ALICE
              ? columns === "snapshot,revision" ? { snapshot: current, revision: opts.revision ?? 1 } : { snapshot: current }
              : null, error: null };
          } };
        } };
      },
      async rpc(name: string, args: Record<string, unknown>) {
        if (name !== "complete_learning_session") throw new Error("JWT client may not call v3 writer");
        legacyCalls += 1;
        return { data: args.p_scores, error: null };
      },
    } as unknown as RequestContext["db"],
  });
  const writer = {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== "complete_learning_session_v3") throw new Error("Unexpected privileged RPC");
      calls.push({ name, args });
      return opts.rpcError
        ? { data: null, error: opts.rpcError }
        : { data: opts.malformedResult ? { invalid: true } : args.p_scores, error: null };
    },
    from() { throw new Error("Privileged writer cannot query an arbitrary table"); },
  } as unknown as RequestContext["db"];
  let writerConstructed = 0;
  const app = createApp(config(opts.enabled ?? true), {
    authenticate: async (req: Request) => {
      const token = req.headers.get("authorization");
      if (token === "Bearer alice") return jwtCtx(ALICE);
      if (token === "Bearer bob") return jwtCtx(BOB);
      throw new HttpError(401, "Oturum doğrulanamadı", "UNAUTHENTICATED");
    },
    ...(opts.injectWriter === false ? {} : { reviewWriter: () => {
      writerConstructed += 1;
      return writer;
    } }),
  });
  const request = (who: "alice" | "bob" | "guest" = "alice") =>
    new Request(`http://localhost/api/learning/sessions/${SESSION}/complete`, {
      method: "POST", headers: { Authorization: `Bearer ${who}` }, body: "{}",
    });
  return { app, request, calls, get readCount() { return readCount; },
    get writerConstructed() { return writerConstructed; }, get legacyCalls() { return legacyCalls; } };
}

describe("Phase 4B v3 privileged completion boundary (mocked)", () => {
  test("default-disabled feature preserves legacy completion and never creates a writer", async () => {
    expect(config(false).REVIEW_WRITE_V3_ENABLED).toBe(false);
    const h = harness({ enabled: false });
    const response = await h.app(h.request());
    expect(response.status).toBe(200);
    expect(h.legacyCalls).toBe(1);
    expect(h.writerConstructed).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  test("verified owner and revision are forwarded only by backend", async () => {
    const h = harness();
    const response = await h.app(h.request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scores: [{ id: WORD, score: 88 }] });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.args).toEqual({
      p_owner_id: ALICE,
      p_id: SESSION,
      p_expected_revision: 1,
      p_scores: [{ id: WORD, score: 88 }],
      p_ratings: [{ id: WORD, rating: "good" }],
    });
    expect(h.readCount).toBe(1);
  });

  test("legacy v2 scores remain supported but no SRS rating is fabricated", async () => {
    const h = harness({ snapshot: session(2) });
    expect((await h.app(h.request())).status).toBe(200);
    expect(h.calls[0]?.args.p_scores).toEqual([{ id: WORD, score: 20 }]);
    expect(h.calls[0]?.args.p_ratings).toEqual([]);
  });

  test("unauthenticated request cannot call the privileged writer", async () => {
    const h = harness();
    expect((await h.app(h.request("guest"))).status).toBe(401);
    expect(h.calls).toHaveLength(0);
    expect(h.writerConstructed).toBe(0);
  });

  test("another account cannot complete an inaccessible session", async () => {
    const h = harness();
    expect((await h.app(h.request("bob"))).status).toBe(404);
    expect(h.calls).toHaveLength(0);
  });

  test("unfinished v3 assessments fail before the RPC", async () => {
    const invalid = session();
    invalid.assessment[WORD] = { matchingDone: false, matchingErrors: 0, meaning: null, context: null };
    const h = harness({ snapshot: invalid });
    expect((await h.app(h.request())).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  test("an unexpected session owner or ID cannot be forged in the request body", async () => {
    const h = harness();
    const request = new Request(`http://localhost/api/learning/sessions/${SESSION}/complete`, {
      method: "POST", headers: { Authorization: "Bearer alice", "x-user-id": BOB },
      body: JSON.stringify({ owner: BOB, ratings: [{ id: WORD, rating: "easy" }] }),
    });
    expect((await h.app(request)).status).toBe(200);
    expect(h.calls[0]?.args.p_owner_id).toBe(ALICE);
    expect(h.calls[0]?.args.p_ratings).toEqual([{ id: WORD, rating: "good" }]);
  });

  test("revision conflict stops completion with a clear 409", async () => {
    const h = harness({ rpcError: { code: "40001" } });
    const response = await h.app(h.request());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("SESSION_CONFLICT");
  });

  test("missing server-only credential fails closed rather than using JWT for write", async () => {
    const h = harness({ injectWriter: false });
    const response = await h.app(h.request());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("REVIEW_WRITER_NOT_CONFIGURED");
    expect(h.calls).toHaveLength(0);
  });

  test("malformed privileged results are never presented as successful scores", async () => {
    const h = harness({ malformedResult: true });
    const response = await h.app(h.request());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("REVIEW_RESULT_INVALID");
  });

  test("mismatched session snapshot ID is blocked", async () => {
    const h = harness({ snapshot: { ...session(), id: BOB } });
    const response = await h.app(h.request());
    expect(response.status).toBe(409);
    expect(h.calls).toHaveLength(0);
  });
});
