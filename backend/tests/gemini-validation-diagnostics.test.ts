import { expect, test } from "bun:test";
import type { ServerConfig } from "../src/config/env";
import { generateWordList } from "../src/features/ai/gemini";

test("bulk validation reports only bounded rejection categories without user content", async () => {
  const records: unknown[] = [];
  const oldError = console.error;
  const malformed = JSON.stringify({ suggestions: [{ word: "private-test-word" }] });
  const fetcher = (async () => new Response(JSON.stringify({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: malformed }] } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  console.error = (...args: unknown[]) => { records.push(args[0]); };
  try {
    await expect(generateWordList(
      1, [], { GEMINI_KEYS: ["test-only"], GEMINI_MODEL_WORD: "gemini-3.5-flash-lite" } as ServerConfig,
      undefined, fetcher, ["private-test-word"],
    )).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
  } finally {
    console.error = oldError;
  }
  const event = records.find((entry) => typeof entry === "object" && entry !== null &&
    "stage" in entry && entry.stage === "validation_rejections") as
    { service: string; stage: string; accepted: number; rejected: { schema: number } } | undefined;
  expect(event).toMatchObject({
    service: "gemini-word-list", stage: "validation_rejections",
    accepted: 0, rejected: { schema: 2 },
  });
  const serialized = JSON.stringify(records);
  expect(serialized).not.toContain("private-test-word");
  expect(serialized).not.toContain("test-only");
});
