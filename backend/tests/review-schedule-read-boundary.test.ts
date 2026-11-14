import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { readConfig } from "../src/config/env";
import { HttpError } from "../src/shared/errors";
import type { RequestContext } from "../src/shared/supabase";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const alpha = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const beta = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const config = readConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable",
  // Intentionally no backend secret; GET cannot require it.
});

type Row = {
  user_id: string;
  word_id: string;
  repetitions: number;
  lapses: number;
  interval_days: number;
  ease_factor: number;
  due_at: string;
  last_reviewed_at: string | null;
};
const row = (userId: string, wordId: string, dueAt = "2026-11-14T09:00:00+00:00"): Row => ({
  user_id: userId, word_id: wordId, repetitions: 1, lapses: 0,
  interval_days: 1, ease_factor: 2.5, due_at: dueAt, last_reviewed_at: null,
});

function harness(data: Row[] = [], dbFailure: { code: string } | null = null) {
  const calls: Array<{ table: string; owner: string; start: number; end: number }> = [];
  let writerCalls = 0;
  function context(userId: string): RequestContext {
    const db = {
      from(table: string) {
        if (table !== "word_review_schedules") throw new Error("Unexpected table: " + table);
        return {
          select(columns: string) {
            if (columns.includes("user_id")) throw new Error("Exposing owner IDs is not needed");
            let owner = "";
            return {
              eq(column: string, value: string) {
                if (column !== "user_id") throw new Error("Missing owner filter");
                owner = value;
                return this;
              },
              order(column: string) {
                if (column !== "due_at" && column !== "word_id") throw new Error("Unstable order");
                return this;
              },
              async range(start: number, end: number) {
                calls.push({ table, owner, start, end });
                if (owner !== userId) throw new Error("Cross-account filter attempted");
                if (dbFailure) return { data: null, error: dbFailure };
                const items = data.filter((item) => item.user_id === owner)
                  .sort((a, b) => a.due_at.localeCompare(b.due_at) || a.word_id.localeCompare(b.word_id));
                return { data: items.slice(start, end + 1), error: null };
              },
            };
          },
        };
      },
    };
    return { userId, db: db as unknown as RequestContext["db"] };
  }
  const authenticate = async (request: Request): Promise<RequestContext> => {
    const token = request.headers.get("authorization");
    if (token === "Bearer alice") return context(alice);
    if (token === "Bearer bob") return context(bob);
    throw new HttpError(401, "Oturum doğrulanamadı", "UNAUTHENTICATED");
  };
  const app = createApp(config, {
    authenticate,
    dailyPlanWriter: () => { writerCalls++; throw new Error("GET constructed privileged writer"); },
  });
  const request = (user: string, method = "GET", headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/account/review-schedules", {
      method, headers: { authorization: `Bearer ${user}`, ...headers },
    });
  return { app, request, calls, get writerCalls() { return writerCalls; } };
}

describe("Phase 4B v2 read-only review schedule API boundary", () => {
  test("authenticated owner receives only their own schedule in normalized DTO form", async () => {
    const h = harness([row(alice, alpha), row(bob, beta)]);
    const response = await h.app(h.request("alice"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schedules: [{
      wordId: alpha, repetitions: 1, lapses: 0, intervalDays: 1, easeFactor: 2.5,
      dueAt: "2026-11-14T09:00:00.000Z", lastReviewedAt: null,
    }] });
    expect(h.calls[0]?.owner).toBe(alice);
    expect(h.writerCalls).toBe(0);
  });

  test("different users never receive another account's reviews", async () => {
    const h = harness([row(alice, alpha), row(bob, beta)]);
    const response = await h.app(h.request("bob", "GET", { "x-user-id": alice }));
    expect(response.status).toBe(200);
    const payload = await response.json() as { schedules: Array<{ wordId: string }> };
    expect(payload.schedules.map((item) => item.wordId)).toEqual([beta]);
    expect(h.calls.every((call) => call.owner === bob)).toBe(true);
  });

  test("guest or missing JWT is rejected", async () => {
    const h = harness([row(alice, alpha)]);
    expect((await h.app(h.request("guest"))).status).toBe(401);
    expect((await h.app(new Request("http://localhost/api/account/review-schedules"))).status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  test("POST cannot mutate schedules through the read endpoint", async () => {
    const h = harness([row(alice, alpha)]);
    const response = await h.app(h.request("alice", "POST"));
    expect(response.status).toBe(404);
    expect(h.calls).toHaveLength(0);
    expect(h.writerCalls).toBe(0);
  });

  test("empty queue is represented by an empty array", async () => {
    const h = harness();
    expect(await (await h.app(h.request("alice"))).json()).toEqual({ schedules: [] });
  });

  test("owner reads are paginated without truncating records", async () => {
    const rows = Array.from({ length: 401 }, (_, i) => row(
      alice, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    ));
    const h = harness(rows);
    const response = await h.app(h.request("alice"));
    const payload = await response.json() as { schedules: unknown[] };
    expect(response.status).toBe(200);
    expect(payload.schedules).toHaveLength(401);
    expect(h.calls.map((item) => item.start)).toEqual([0, 200, 400]);
  });

  test("invalid stored records fail closed; never return a partial queue", async () => {
    const invalid = { ...row(alice, alpha), ease_factor: 4.2 };
    const h = harness([row(alice, beta), invalid]);
    const response = await h.app(h.request("alice"));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("REVIEW_SCHEDULE_INVALID");
  });

  test("database errors are not misreported as an empty queue", async () => {
    const h = harness([], { code: "42501" });
    const response = await h.app(h.request("alice"));
    expect(response.status).toBe(403);
  });

  test("oversized queue fails closed rather than silently truncating", async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => row(
      alice, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    ));
    const h = harness(rows);
    const response = await h.app(h.request("alice"));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("REVIEW_SCHEDULE_LIMIT");
  });

  test("duplicate data cannot return an ambiguous queue", async () => {
    const h = harness([row(alice, alpha), row(alice, alpha)]);
    const response = await h.app(h.request("alice"));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("REVIEW_SCHEDULE_INVALID");
  });
});
