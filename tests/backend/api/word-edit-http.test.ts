import { describe, expect, test } from "bun:test";
import { createApp } from "../../../backend/src/app";
import { readConfig } from "../../../backend/src/config/env";
import type { RequestContext } from "../../../backend/src/shared/supabase";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const visibleRevision = "2026-11-24T01:00:00.123Z";
const row = {
  id,
  word: "Assess",
  score: 87,
  content: { meanings: ["değerlendirmek"], usageNote: "new note", srs: { interval: 4 } },
  created_at: "2026-11-23T01:00:00.000Z",
  updated_at: "2026-11-24T01:00:00.123456Z",
};

function route(race = false) {
  const updates: Record<string, unknown>[] = [];
  const filters: Record<string, unknown> = {};
  const db = {
    from: () => {
      const query = {
        eq(key: string, value: unknown) {
          filters[key] = value;
          return query;
        },
        select() {
          return query;
        },
        update(fields: Record<string, unknown>) {
          updates.push(fields);
          return query;
        },
        async maybeSingle() {
          const fields = updates.at(-1);
          return { data: fields ? (race ? null : { ...row, ...fields }) : row, error: null };
        },
      };
      return query;
    },
  };
  const app = createApp(readConfig({}), {
    authenticate: async () => ({ userId: id, db }) as unknown as RequestContext,
  });
  return {
    updates,
    filters,
    patch: (body: unknown, revision: string | null = visibleRevision, method = "PATCH") =>
      app(
        new Request("http://localhost/api/words/" + id, {
          method,
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            ...(revision ? { "X-Atlas-Expected-Updated-At": revision } : {}),
          },
        }),
      ),
  };
}

describe("personal content edit API", () => {
  test("requires a revision and rejects score, learning data and empty patches", async () => {
    const api = route();
    expect((await api.patch({ usageNote: "draft" }, null)).status).toBe(400);
    expect((await api.patch({ word: "Assess", score: 0 }, null, "PUT")).status).toBe(400);
    for (const body of [{ score: 0 }, { usageNote: "draft", srs: {} }, {}])
      expect((await api.patch(body)).status).toBe(400);
    expect(api.updates).toEqual([]);
  });

  test("rejects a stale edit before attempting a write", async () => {
    const api = route();
    const result = await api.patch({ examples: [] }, "2026-11-23T01:00:00.001Z");
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "WORD_VERSION_CONFLICT" });
    expect(api.updates).toEqual([]);
  });

  test("merges only editable fields and conditions the write on the exact database revision", async () => {
    const api = route();
    const examples = [
      { sentence: "We assess the policy.", translation: "Politikayı değerlendiriyoruz." },
    ];
    const result = await api.patch({ examples });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ score: 87, usageNote: "new note", examples });
    expect(api.updates).toHaveLength(1);
    expect(Object.keys(api.updates[0])).toEqual(["content"]);
    expect(api.updates[0].content).toEqual({ ...row.content, examples });
    expect(api.filters).toEqual({ id, updated_at: row.updated_at, score: 87, word: "Assess" });
  });

  test("legacy full edits preserve the existing score and protected JSON fields", async () => {
    const api = route();
    const result = await api.patch(
      { word: "Assess", score: 99, usageNote: "newer" },
      visibleRevision,
      "PUT",
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ score: 87, usageNote: "newer" });
    expect(api.updates[0]).not.toHaveProperty("score");
    expect(api.updates[0].content).toMatchObject({ srs: { interval: 4 } });
  });

  test("reports a version conflict when a concurrent write wins after the read", async () => {
    const api = route(true);
    const result = await api.patch({ usageNote: "draft" });
    expect(api.filters.updated_at).toBe(row.updated_at);
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "WORD_VERSION_CONFLICT" });
  });
});
