import { expect, spyOn, test } from "bun:test";
import { readConfig } from "../../../backend/src/config/env";
import { listWords } from "../../../backend/src/features/words/word-service";
import { userClient } from "../../../backend/src/shared/supabase";

const rows = Array.from({ length: 1001 }, (_, index) => ({
  id: String(index).padStart(5, "0"),
  word: `Word${index}`,
  score: 0,
  content: {},
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
}));

for (const scenario of [
  "empty",
  "complete",
  "null",
  "short",
  "row cap",
  "at cap",
  "over cap complete",
  "missing count",
  "duplicate",
  "replacement between reads",
  "delete and insert between reads",
  "update between reads",
] as const) {
  test(`account library pagination: ${scenario}`, async () => {
    const totals: Record<string, number> = {
      empty: 0,
      "at cap": 1000,
      "row cap": 1001,
      "over cap complete": 1001,
    };
    const total = totals[scenario] ?? 501;
    let reads = 0;
    async function respond(input: Parameters<typeof fetch>[0], init?: RequestInit) {
      if (new URL(String(input)).pathname.endsWith("/rpc/atlas_word_page")) {
        const cursor = JSON.parse(String(init?.body));
        const start = cursor.p_id === null ? 0 : Number(cursor.p_id) + 1;
        expect(cursor.p_revision).toBe(start ? "7" : null);
        reads++;
        return Response.json({
          owner: "synthetic",
          revision: "7",
          total: start ? null : 1001,
          rows: rows.slice(start, start + 128),
        });
      }
      const start = Number(new URL(String(input)).searchParams.get("offset"));
      reads++;
      const limit = Number(new URL(String(input)).searchParams.get("limit") ?? total);
      const data = rows.slice(
        start,
        Math.min(total, start + limit, scenario === "row cap" ? 1000 : total),
      );
      if (start && scenario === "replacement between reads")
        data[0] = { ...rows[500], id: "replacement" };
      if (start && scenario === "update between reads") data[0] = { ...rows[500], score: 90 };
      if (start && scenario === "delete and insert between reads")
        data[0] = { ...rows[500], id: "new-after-delete" };
      if (start === 0) expect(new Headers(init?.headers).get("prefer")).toContain("count=exact");
      if (data.length && scenario === "duplicate") data[data.length - 1] = rows[0];
      const body = scenario === "null" ? null : scenario === "short" ? [] : data;
      return Response.json(body, {
        headers:
          scenario === "missing count"
            ? {}
            : {
                "Content-Range":
                  total === 0 ? "*/0" : `${start}-${start + data.length - 1}/${total}`,
              },
      });
    }
    const mocked = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(respond, { preconnect: fetch.preconnect }),
    );
    try {
      const db = userClient(
        readConfig({ SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_PUBLISHABLE_KEY: "synthetic" }),
        "synthetic",
      );
      const result = listWords({ db, userId: "synthetic" });
      if (scenario === "row cap")
        expect((await result).map((word) => word.id)).toEqual(rows.map((row) => row.id));
      else if (
        ["empty", "complete", "at cap", "over cap complete"].includes(scenario) ||
        scenario.endsWith("between reads")
      )
        expect((await result).map((word) => word.id)).toEqual(
          rows.slice(0, total).map((word) => word.id),
        );
      else await expect(result).rejects.toThrow();
      expect(reads).toBe(["row cap", "over cap complete"].includes(scenario) ? 9 : 1);
    } finally {
      mocked.mockRestore();
    }
  });
}
