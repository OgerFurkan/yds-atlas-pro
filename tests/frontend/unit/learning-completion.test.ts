import { expect, test } from "bun:test";
import { completeLearningTask } from "../../../frontend/src/features/learning-game/model/complete-learning-task";
import type { GameSession } from "../../../frontend/src/features/learning-game/model/game-session";

test("offline practice completes without a score or authoritative session write", async () => {
  const session = { localPractice: true } as GameSession;
  const unexpected = async () => {
    throw Error("Unexpected completion writer");
  };
  expect(await completeLearningTask(session, unexpected, unexpected)).toBe(true);
});

test("account completion takes its practice classification from the authoritative result", async () => {
  const session = {} as GameSession;
  expect(
    await completeLearningTask(
      session,
      async (input) => {
        expect(input).toBe(session);
        return { practiceOnly: false };
      },
      async () => {
        throw Error("Unexpected guest writer");
      },
    ),
  ).toBe(false);
});
