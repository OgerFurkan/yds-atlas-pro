import { describe, expect, test } from "bun:test";
import { lastFailedUserQuestion } from "../../src/features/ai-chat/model/chat-retry";

describe("Atlas AI manual retry", () => {
  test("replays the last failed user question, not earlier chat history", () => {
    const messages = [
      { role: "user" as const, content: "What is indicate?" },
      { role: "assistant" as const, content: "To show." },
      { role: "user" as const, content: "Give me a YDS example." },
    ];
    expect(lastFailedUserQuestion(messages)).toEqual([
      { role: "user", content: "Give me a YDS example." },
    ]);
    expect(messages).toHaveLength(3);
  });

  test("never sends an assistant reply as the retry request", () => {
    expect(lastFailedUserQuestion([
      { role: "user", content: "Indicate ne demek?" },
      { role: "assistant", content: "Göstermek." },
    ])).toEqual([{ role: "user", content: "Indicate ne demek?" }]);
  });

  test("empty or assistant-only history yields no retry request", () => {
    expect(lastFailedUserQuestion([])).toEqual([]);
    expect(lastFailedUserQuestion([{ role: "assistant", content: "Hello" }])).toEqual([]);
    expect(lastFailedUserQuestion([{ role: "user", content: "   " }])).toEqual([]);
  });
});
