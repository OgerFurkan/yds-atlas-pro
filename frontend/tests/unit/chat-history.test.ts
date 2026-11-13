import { describe, expect, test } from "bun:test";
import { deleteHistoryConversation } from "../../src/features/ai-chat/model/chat-history";

describe("Atlas AI chat history deletion", () => {
  const existing = [
    [{ role: "user", content: "Indicate ne demek?" }],
    [{ role: "user", content: "Explain imply" }],
    [{ role: "user", content: "YDS vocabulary" }],
  ];

  test("deletes only the selected conversation and preserves the original history", () => {
    const result = deleteHistoryConversation(existing, 1);
    expect(result).toEqual([existing[0], existing[2]]);
    expect(existing).toHaveLength(3);
    expect(result[0]).toBe(existing[0]);
  });

  test("deletes the first or final conversation correctly", () => {
    expect(deleteHistoryConversation(existing, 0)).toEqual([existing[1], existing[2]]);
    expect(deleteHistoryConversation(existing, 2)).toEqual([existing[0], existing[1]]);
  });

  test("ignores invalid indexes safely", () => {
    for (const index of [-1, 3, 1.5, Number.NaN]) {
      expect(deleteHistoryConversation(existing, index)).toEqual(existing);
    }
    expect(deleteHistoryConversation([], 0)).toEqual([]);
  });
});
