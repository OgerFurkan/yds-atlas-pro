import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { readConfig } from "../src/config/env";
import { HttpError } from "../src/shared/errors";
import type { RequestContext } from "../src/shared/supabase";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
function config(enabled?: boolean) {
  return readConfig({
    SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "test-public",
    ...(enabled === undefined ? {} : { GOAL_WRITE_V6_ENABLED: String(enabled) }),
  });
}
function harness(options: { enabled?: boolean; errCode?: string; result?: unknown; writer?: boolean } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let jwtCalls = 0; let writerCalls = 0;
  const jwtCtx = (userId: string): RequestContext => ({ userId,
    db: { async rpc(name: string, args: Record<string, unknown>) {
      if (name !== "set_daily_goal") throw Error("JWT client attempted private RPC");
      jwtCalls++; return { data: args.p_goal, error: null };
    } } as unknown as RequestContext["db"],
  });
  const privateWriter = { async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args });
    if (name !== "set_daily_goal_v6") throw Error("Unexpected privileged RPC");
    return options.errCode ? { data: null, error: { code: options.errCode } } :
      { data: options.result === undefined ? args.p_goal : options.result, error: null };
  } } as unknown as RequestContext["db"];
  const app = createApp(config(options.enabled), {
    authenticate: async (request) => {
      const token = request.headers.get("authorization");
      if (token === "Bearer alice") return jwtCtx(ALICE);
      if (token === "Bearer bob") return jwtCtx(BOB);
      throw new HttpError(401, "Oturum doğrulanamadı", "UNAUTHENTICATED");
    },
    ...(options.writer === false ? {} : { goalWriter: () => { writerCalls++; return privateWriter; } }),
  });
  const req = (body: object = { goal: 20 }, who = "alice", headers = {}) =>
    new Request("http://localhost/api/account/goal", { method: "PUT", headers: {
      Authorization: `Bearer ${who}`, "Content-Type": "application/json", ...headers,
    }, body: JSON.stringify(body) });
  return { app, req, calls, get jwtCalls() { return jwtCalls; },
    get writerCalls() { return writerCalls; } };
}

describe("v5C-C opt-in private goal writer", () => {
  test("default OFF keeps JWT goal RPC", async () => {
    const h = harness(); const res = await h.app(h.req());
    expect(config().GOAL_WRITE_V6_ENABLED).toBe(false);
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ goal: 20 });
    expect(h.jwtCalls).toBe(1); expect(h.writerCalls).toBe(0);
  });
  test("enabled uses service writer only and verified owner", async () => {
    const h = harness({ enabled: true }); const res = await h.app(h.req({ goal: 30 }));
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ goal: 30 });
    expect(h.jwtCalls).toBe(0); expect(h.calls).toEqual([{
      name: "set_daily_goal_v6", args: { p_owner_id: ALICE, p_goal: 30 },
    }]);
  });
  test("browser header cannot forge owner", async () => {
    const h = harness({ enabled: true });
    expect((await h.app(h.req({ goal: 20 }, "alice", { "x-user-id": BOB }))).status).toBe(200);
    expect(h.calls[0]?.args.p_owner_id).toBe(ALICE);
  });
  test("extra owner field is rejected before privileged writer", async () => {
    const h = harness({ enabled: true });
    expect((await h.app(h.req({ goal: 20, owner: BOB }))).status).toBe(400);
    expect(h.calls).toHaveLength(0); expect(h.writerCalls).toBe(0);
  });
  test("unauthenticated cannot initialize writer", async () => {
    const h = harness({ enabled: true });
    expect((await h.app(h.req({ goal: 20 }, "guest"))).status).toBe(401);
    expect(h.writerCalls).toBe(0); expect(h.calls).toHaveLength(0);
  });
  test("invalid goal values never call writer", async () => {
    const h = harness({ enabled: true });
    for (const goal of [0, 5, 15, 120, 25.5, "20"]) {
      expect((await h.app(h.req({ goal }))).status).toBe(400);
    }
    expect(h.writerCalls).toBe(0);
  });
  test("service grant rejection fails closed without legacy call", async () => {
    const h = harness({ enabled: true, errCode: "42501" }); const res = await h.app(h.req());
    expect(res.status).toBe(403); expect(h.jwtCalls).toBe(0);
  });
  test("missing secret fails closed when enabled", async () => {
    const h = harness({ enabled: true, writer: false }); const res = await h.app(h.req());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("GOAL_WRITER_NOT_CONFIGURED");
    expect(h.jwtCalls).toBe(0);
  });
  test("bad RPC results are never success", async () => {
    for (const result of [null, "20", 19, 30, {}, 20.5]) {
      const h = harness({ enabled: true, result });
      const res = await h.app(h.req());
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("GOAL_WRITE_RESULT_INVALID");
    }
  });
});
