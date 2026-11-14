import type { GameSession } from "@yds-atlas/shared";

function completeSession(): GameSession {
  return {
    version: 3, groupMatching: true, id: "session-1", words: [{
      id: "word-1", word: "abandon", alternatives: [], meanings: ["terk etmek"],
      usageNote: "", partOfSpeech: "verb", cefr: "B2", score: 20, examples: [],
      pronunciationUk: "", pronunciationUs: "", sourceUrl: "",
      createdAt: "2026-11-14T12:00:00.000Z", updatedAt: "2026-11-14T12:00:00.000Z",
    }],
    batchSize: 5, groupIndex: 0, phase: "complete", queue: [], stageCompleted: 3,
    attempts: {}, scoreChanges: {}, matching: null, answer: null,
    assessment: { "word-1": {
      matchingDone: true, matchingErrors: 0,
      meaning: { correct: true, confidence: 0 },
      context: { correct: true, confidence: 0 },
    } },
    finalCorrect: 2, finalTotal: 2, tutorial: false, saved: true,
  };
}

export { completeSession };
