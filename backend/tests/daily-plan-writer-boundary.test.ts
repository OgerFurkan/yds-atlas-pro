import { describe, expect, test } from "bun:test";
import type { DailyPlanSnapshot } from "@yds-atlas/shared";
import { createApp } from "../src/app";
import { readConfig } from "../src/config/env";
import { HttpError } from "../src/shared/errors";
import type { RequestContext } from "../src/shared/supabase";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const aliceWord = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bobWord = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const config = readConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable",
  // Intentionally absent: production secret must only come from the backend.
});
const plan = (wordId: string): DailyPlanSnapshot => ({
  groupSize: 20,
  assignments: [{ day: 1, words: [wordId] }],
  excludedWordIds: [],
});

type Stored = { revision: number; payload: DailyPlanSnapshot };
function harness() {
  const states = new Map<string, Stored>();
  const writes: { action: "insert" | "update"; owner: string; revision: number }[] = [];
  const owned = new Map([[alice, aliceWord], [bob, bobWord]]);

  function context(userId: string): RequestContext {
    const db = {
      from(table: string) {
        if (table === "words") return {
          select(_columns: string) {
            return { eq(_name: string, ownerId: string) {
              return { async in(_field: string, ids: string[]) {
                return {
                  data: ids.filter((id) => id === owned.get(ownerId)).map((id) => ({ id })),
                  error: null,
                };
              } };
            } };
          },
        };
        if (table === "daily_plan_states") return {
          select(_columns: string) {
            return { eq(_column: string, ownerId: string) {
              return { async maybeSingle() {
                return { data: states.get(ownerId) ?? null, error: null };
              } };
            } };
          },
        };
        throw new Error(`Unexpected user-scoped table: ${table}`);
      },
    };
    // Deliberately no insert/update on the JWT-scoped client.
    return { userId, db: db as unknown as RequestContext["db"] };
  }

  const writer = {
    from(table: string) {
      if (table !== "daily_plan_states") throw new Error(`Privileged writer requested ${table}`);
      return {
        insert(value: { user_id: string; revision: number; payload: DailyPlanSnapshot }) {
          writes.push({ action: "insert", owner: value.user_id, revision: value.revision });
          return { select(_columns: string) { return { async single() {
            if (states.has(value.user_id)) return { data: null, error: { code: "23505" } };
            const next = { revision: value.revision, payload: value.payload };
            states.set(value.user_id, next);
            return { data: next, error: null };
          } }; } };
        },
        update(value: { revision: number; payload: DailyPlanSnapshot }) {
          const filters: Record<string, unknown> = {};
          return {
            eq(column: string, expected: unknown) { filters[column] = expected; return this; },
            select(_columns: string) { return { async maybeSingle() {
              const ownerId = filters.user_id as string;
              writes.push({ action: "update", owner: ownerId, revision: value.revision });
              const previous = states.get(ownerId);
              if (!previous || previous.revision !== filters.revision)
                return { data: null, error: null };
              const next = { revision: value.revision, payload: value.payload };
              states.set(ownerId, next);
              return { data: next, error: null };
            } }; },
          };
        },
      };
    },
  } as unknown as RequestContext["db"];

  async function authenticate(request: Request): Promise<RequestContext> {
    const token = request.headers.get("authorization");
    if (token === "Bearer alice") return context(alice);
    if (token === "Bearer bob") return context(bob);
    throw new HttpError(401, "Oturum doğrulanamadı", "UNAUTHENTICATED");
  }
  const app = createApp(config, { authenticate, dailyPlanWriter: () => writer });
  const request = (
    owner: "alice" | "bob" | "guest",
    method: "GET" | "PUT",
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ) => new Request("http://localhost/api/account/daily-plan", {
    method,
    headers: {
      authorization: `Bearer ${owner}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { app, states, writes, request, authenticate };
}

describe("Phase 3B v1.5 privileged daily-plan writer boundary (mocked backend)", () => {
  test("GET reads under the user JWT and never constructs the privileged writer", async () => {
    const h = harness();
    const response = await h.app(h.request("alice", "GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 0, snapshot: null });
    expect(h.writes).toHaveLength(0);
  });

  test("unauthenticated and malformed PUT requests never write", async () => {
    const h = harness();
    expect((await h.app(h.request("guest", "PUT", { snapshot: plan(aliceWord), expectedRevision: 0 }))).status).toBe(401);
    expect((await h.app(h.request("alice", "PUT", {
      snapshot: plan(aliceWord), expectedRevision: 0, user_id: bob,
    }))).status).toBe(400);
    expect(h.writes).toHaveLength(0);
  });

  test("first save then revision-matched PUT uses only the trusted writer", async () => {
    const h = harness();
    const first = await h.app(h.request("alice", "PUT", { snapshot: plan(aliceWord), expectedRevision: 0 }));
    expect(first.status).toBe(200);
    expect((await first.json()).revision).toBe(1);
    const second = await h.app(h.request("alice", "PUT", { snapshot: plan(aliceWord), expectedRevision: 1 }));
    expect(second.status).toBe(200);
    expect((await second.json()).revision).toBe(2);
    expect(h.states.get(alice)?.revision).toBe(2);
    expect(h.writes).toEqual([
      { action: "insert", owner: alice, revision: 1 },
      { action: "update", owner: alice, revision: 2 },
    ]);
  });

  test("revision conflicts preserve the previous state; header spoofing cannot change owner", async () => {
    const h = harness();
    await h.app(h.request("alice", "PUT", { snapshot: plan(aliceWord), expectedRevision: 0 }));
    const stale = await h.app(h.request("alice", "PUT", {
      snapshot: plan(aliceWord), expectedRevision: 2,
    }, { "x-user-id": bob }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("DAILY_PLAN_CONFLICT");
    expect(h.states.get(alice)?.revision).toBe(1);
    expect(h.states.has(bob)).toBe(false);
  });

  test("foreign word IDs are rejected before privileged writes, even with a forged header", async () => {
    const h = harness();
    const response = await h.app(h.request("alice", "PUT", {
      snapshot: plan(bobWord), expectedRevision: 0,
    }, { "x-user-id": bob }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DAILY_PLAN_STALE_WORDS");
    expect(h.writes).toHaveLength(0);
  });

  test("without a server-only secret key the API refuses PUT instead of writing as the user", async () => {
    const h = harness();
    const noWriter = createApp(config, { authenticate: h.authenticate });
    const response = await noWriter(h.request("alice", "PUT", {
      snapshot: plan(aliceWord), expectedRevision: 0,
    }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("DAILY_PLAN_WRITER_NOT_CONFIGURED");
    expect(h.writes).toHaveLength(0);
  });
});
