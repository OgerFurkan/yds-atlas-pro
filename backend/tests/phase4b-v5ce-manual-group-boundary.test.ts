import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { readConfig } from "../src/config/env";
import { HttpError } from "../src/shared/errors";
import { getVisibleWordGroup, wordEntrySchema } from "@yds-atlas/shared";
import { mapWord } from "../src/features/words/word-service";
import type { RequestContext } from "../src/shared/supabase";

const ALICE = "11111111-1111-4111-8111-111111111111";
const WORD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function harness(result: unknown = 1, errorCode?: string) {
  const calls: Array<{name: string; args: unknown}> = [];
  const app = createApp(readConfig({}), {
    authenticate: async (req) => {
      if (req.headers.get("authorization") !== "Bearer alice")
        throw new HttpError(401, "Oturum gerekiyor", "UNAUTHENTICATED");
      return { userId: ALICE, db: {
        async rpc(name: string, args: unknown) {
          calls.push({ name, args });
          return { data: result, error: errorCode ? { code: errorCode } : null };
        },
      } as unknown as RequestContext["db"] };
    },
  });
  const req = (body: unknown, token = "alice") => new Request("http://localhost/api/words/groups", {
    method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { app, req, calls };
}

describe("v5C-E explicit manual group boundary", () => {
  test("legacy group fallback remains identical", () => {
    expect(getVisibleWordGroup({ score: 0 })).toBe("hard");
    expect(getVisibleWordGroup({ score: 50, manualGroup: null })).toBe("review");
    expect(getVisibleWordGroup({ score: 90 })).toBe("learned");
  });
  test("manual label overrides UI classification but not stored mastery score", () => {
    expect(getVisibleWordGroup({ score: 0, manualGroup: "learned" })).toBe("learned");
    expect(getVisibleWordGroup({ score: 95, manualGroup: "hard" })).toBe("hard");
  });
  test("database column, not untrusted content, determines manual group", () => {
    const mapped = mapWord({
      id: WORD, word: "Evidence", score: 10, manual_group: "learned",
      content: { score: 100, manualGroup: "hard" },
      created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z",
    });
    expect(mapped.score).toBe(10);
    expect(mapped.manualGroup).toBe("learned");
    expect(getVisibleWordGroup(mapped)).toBe("learned");
  });
  test("schema preserves optional manual group when reading a word", () => {
    const mapped = mapWord({
      id: WORD, word: "Evidence", score: 30, content: { manualGroup: "learned" },
      created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z",
    });
    expect(mapped.manualGroup).toBeNull();
    expect(wordEntrySchema.parse(mapped).manualGroup).toBeNull();
  });
  test("owner-scoped RPC receives only approved id/group fields", async () => {
    const h = harness(); const r = await h.app(h.req([{ id: WORD, group: "learned" }]));
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ updated: true });
    expect(h.calls).toEqual([{ name: "set_word_groups_v7", args: {
      p_groups: [{ id: WORD, group_name: "learned" }],
    } }]);
  });
  test("multiple distinct groups are sent atomically", async () => {
    const h = harness(2); const r = await h.app(h.req([
      { id: WORD, group: "review" }, { id: OTHER, group: "hard" },
    ]));
    expect(r.status).toBe(200); expect(h.calls).toHaveLength(1);
  });
  test("missing auth never reaches RPC", async () => {
    const h = harness(); expect((await h.app(h.req([{ id: WORD, group: "hard" }], "guest"))).status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });
  test("user-supplied owner fields are rejected", async () => {
    const h = harness(); expect((await h.app(h.req([{ id: WORD, group: "learned", owner: OTHER }]))).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
  test("duplicate IDs and unsupported labels are rejected", async () => {
    const h = harness();
    expect((await h.app(h.req([{ id: WORD, group: "hard" }, { id: WORD, group: "review" }]))).status).toBe(400);
    expect((await h.app(h.req([{ id: WORD, group: "unknown" }]))).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
  test("RPC 42501 is forbidden, not success", async () => {
    const h = harness(0, "42501"); const r = await h.app(h.req([{ id: WORD, group: "hard" }]));
    expect(r.status).toBe(403);
  });
  test("partial or malformed RPC result fails closed", async () => {
    for (const v of [0, 2, "1", null, {}, 1.5]) {
      const h = harness(v); const r = await h.app(h.req([{ id: WORD, group: "review" }]));
      expect(r.status).toBe(503);
      expect((await r.json()).code).toBe("WORD_GROUP_RESULT_INVALID");
    }
  });
});
