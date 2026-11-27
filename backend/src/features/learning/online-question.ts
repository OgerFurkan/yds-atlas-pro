import { createHmac } from "node:crypto";
import type { GameSession, OnlineAction, OnlineView, WordEntry } from "@yds-atlas/shared";
import {
  advance,
  currentWord,
  isFinal,
  makeQuestion,
  recordAnswer,
  setConfidence,
  usableExamples,
} from "@yds-atlas/shared/game-engine";
import { continueMatching, retryMatching, selectMatching } from "@yds-atlas/shared/matching-engine";
import { invalidAssessment } from "./assessment-scoring";

type Status = OnlineView["status"];
function opaque(state: GameSession, revision: number, side: string, index: number) {
  // The engine seed is server-generated and never used as the public session ID.
  return createHmac("sha256", state.id)
    .update(`${revision}/${side}/${index}`)
    .digest("hex")
    .slice(0, 32);
}
function lesson(word: WordEntry, example: WordEntry["examples"][number] | undefined) {
  const {
    word: text,
    meanings,
    partOfSpeech,
    cefr,
    usageNote,
    pronunciationUk,
    pronunciationUs,
    attribution,
  } = word;
  return {
    word: text,
    meanings,
    partOfSpeech,
    cefr,
    usageNote,
    pronunciationUk,
    pronunciationUs,
    attribution,
    sentence: example?.sentence,
    translation: example?.translation,
    examples: usableExamples(word).slice(0, 5),
  };
}

export function onlineView(
  id: string,
  revision: number,
  status: Status,
  state: GameSession,
  accepted: ReadonlyMap<string, number> = new Map(),
): OnlineView {
  const view: OnlineView = {
    id,
    revision,
    status,
    phase: state.phase,
    group: state.groupIndex + 1,
    total: state.words.length,
    done: state.stageCompleted,
  };
  if (status === "complete") {
    view.results = state.words.map((word) => ({
      word: word.word,
      meaning: word.meanings[0],
      score: accepted.get(word.id) ?? null,
    }));
    return view;
  }
  if (status !== "active") return view;
  const board = state.matching;
  if (board && state.phase.endsWith("matching")) {
    view.choices = (["left", "right"] as const).flatMap((side) =>
      board[side].map((wordId, i) => {
        const word = state.words.find((item) => item.id === wordId);
        if (!word) throw new Error("Assessment matching word is missing.");
        return {
          token: opaque(state, revision, side, i),
          text: side === "left" ? word.word : word.meanings[0],
          side,
          selected: wordId === (side === "left" ? board.selectedLeft : board.selectedRight),
          matched: board.matched.includes(wordId),
        };
      }),
    );
    view.feedback = board.feedback?.correct;
    view.next = board.feedback?.correct === false || board.matched.length === board.left.length;
    return view;
  }
  const word = currentWord(state);
  if (!word) throw invalidAssessment();
  if (state.phase === "flashcards") {
    view.prompt = word.word;
    view.lesson = lesson(word, word.examples[0]);
    view.next = true;
    return view;
  }
  const q = makeQuestion(state);
  if (!q) throw invalidAssessment();
  view.prompt = q.context ? q.sentence : word.word;
  view.choices = q.choices.map((label, i) => ({
    token: opaque(state, revision, "answer", i),
    text: label,
  }));
  if (state.answer) {
    view.feedback = state.answer.correct;
    view.lesson = lesson(word, q.example);
    view.confidence = isFinal(state) && state.answer.correct && state.answer.confidence === null;
    view.next = !view.confidence;
  }
  return view;
}
export function takeOnlineAction(
  id: string,
  revision: number,
  state: GameSession,
  action: OnlineAction,
) {
  const view = onlineView(id, revision, "active", state);
  if (action.kind === "choose") {
    const choices = view.choices ?? [];
    const index = choices.findIndex((item) => item.token === action.token);
    if (index < 0) throw invalidAssessment();
    const selected = choices[index];
    if (selected.side && state.matching) {
      const side = selected.side;
      const position = choices
        .filter((x) => x.side === side)
        .findIndex((x) => x.token === selected.token);
      return selectMatching(state, side, state.matching[side][position]);
    }
    return recordAnswer(state, selected.text);
  }
  if (action.kind === "confidence" && view.confidence) return setConfidence(state, action.value);
  if (action.kind === "next" && view.next) {
    if (state.matching && state.phase.endsWith("matching"))
      return state.matching.feedback?.correct === false
        ? retryMatching(state)
        : continueMatching(state);
    return advance(state);
  }
  throw invalidAssessment();
}
