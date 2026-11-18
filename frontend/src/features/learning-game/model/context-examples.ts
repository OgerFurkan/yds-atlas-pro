import { chooseTieredExample, hasCompleteTierSet, type WordExample } from "@yds-atlas/shared";

/** Purpose is editorial intent, NOT proof of calibrated YDS difficulty. */
export function contextExamplesForPhase<T extends { purpose?: "practice" | "exam" }>(
  usable: readonly T[],
  final: boolean,
): T[] {
  const intended = final ? "exam" : "practice";
  const matches = usable.filter((item) => item.purpose === intended);
  if (matches.length) return matches;
  // A record labeled for the opposite phase must not leak into this phase.
  if (usable.some((item) => item.purpose !== undefined)) return [];
  return [...usable];
}

type ContextSelection<T> =
  | { status: "selected"; example: T }
  | { status: "legacy" }
  | { status: "missing" };

function stableSeedHash(seed: string): number {
  let value = 2166136261;
  for (const ch of seed) {
    value ^= ch.charCodeAt(0);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

/**
 * Priority: verified 2/1/2 difficulty -> editorial purpose -> unlabeled legacy.
 * Never infer YDS certification from `purpose: "exam"`.
 * Any partial/conflicting graded set blocks the question instead of falling back.
 */
export function selectContextExample<T extends WordExample>(
  usable: readonly T[],
  final: boolean,
  attempt: number,
  seed: string,
): ContextSelection<T> {
  if (!Number.isSafeInteger(attempt) || attempt < 0) return { status: "missing" };

  const graded = usable.filter((item) => item.difficulty !== undefined);
  if (graded.length > 0) {
    if (!hasCompleteTierSet(graded)) return { status: "missing" };
    if (graded.some((item) => {
      const expectedPurpose = item.difficulty === "yds" ? "exam" : "practice";
      return item.purpose !== undefined && item.purpose !== expectedPurpose;
    })) return { status: "missing" };
    const example = chooseTieredExample(graded, final ? "final" : "group", attempt, seed);
    return example ? { status: "selected", example } : { status: "missing" };
  }

  if (usable.some((item) => item.purpose !== undefined)) {
    const matches = contextExamplesForPhase(usable, final);
    if (!matches.length) return { status: "missing" };
    const index = final
      ? (stableSeedHash(seed) + attempt) % matches.length
      : (attempt + 1) % matches.length;
    return { status: "selected", example: matches[index] };
  }

  // Legacy five-example selection stays in game-engine.ts with its original seed.
  return { status: "legacy" };
}
