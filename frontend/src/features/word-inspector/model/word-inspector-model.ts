import type { InspectorChoice, InspectorEntry } from "../api/word-inspector-api";

export const inspectorDifficultyLabels = {
  easy: "Kolay",
  medium: "Orta",
  yds: "YDS",
} as const;

export function matchingInspectorChoice(
  choice: InspectorChoice,
  current: InspectorChoice | null,
): boolean {
  return (
    current !== null &&
    choice.id === current.id &&
    choice.revision === current.revision &&
    choice.partOfSpeech === current.partOfSpeech &&
    choice.meaning === current.meaning
  );
}

/** A stale asynchronous save cannot display success for a different entry. */
export function inspectorSaveBelongsTo(
  entry: InspectorEntry | null,
  saved: {
    id: string;
    revision: number;
  } | null,
) {
  return (
    entry !== null && saved !== null && entry.id === saved.id && entry.revision === saved.revision
  );
}

export function countInspectorTiers(entry: InspectorEntry) {
  return {
    easy: entry.examples.filter((item) => item.difficulty === "easy").length,
    medium: entry.examples.filter((item) => item.difficulty === "medium").length,
    yds: entry.examples.filter((item) => item.difficulty === "yds").length,
  };
}
