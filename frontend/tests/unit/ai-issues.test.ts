import { beforeEach, expect, test } from "bun:test";
import { clearAiIssues, getAiIssues, recordAiIssue } from "@/shared/lib/ai-issues";

beforeEach(() => clearAiIssues());

test("issues keep a readable message and replace duplicates by code", () => {
  const quota = Object.assign(new Error("Gemini kotası doldu."), { code: "AI_QUOTA_EXCEEDED" });
  recordAiIssue(quota);
  expect(getAiIssues()).toHaveLength(1);
  expect(getAiIssues()[0]).toMatchObject({
    code: "AI_QUOTA_EXCEEDED",
    kind: "quota",
    message: "Gemini kotası doldu.",
  });
  recordAiIssue(quota);
  expect(getAiIssues()).toHaveLength(1);
});

test("technical errors are stored with a safe fallback message", () => {
  recordAiIssue(new Error("TypeError: expected object at path suggestions[0].meanings"));
  expect(getAiIssues()[0]).toMatchObject({
    code: "UNKNOWN",
    kind: "unknown",
    message: "Beklenmeyen bir AI yanıtı alındı.",
  });
  expect(getAiIssues()).toHaveLength(1);
});

test("clearing removes every stored issue", () => {
  recordAiIssue(Object.assign(new Error("Model bulunamadı."), { code: "AI_MODEL_NOT_FOUND" }));
  recordAiIssue(Object.assign(new Error("Ağ hatası."), { code: "AI_NETWORK_ERROR" }));
  expect(getAiIssues()).toHaveLength(2);
  clearAiIssues();
  expect(getAiIssues()).toEqual([]);
});
