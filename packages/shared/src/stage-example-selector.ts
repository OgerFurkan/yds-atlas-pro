/**
 * Shared Lexicon v1: the only accepted graduated five-example contract.
 * No automatic guessing of difficulty for legacy content.
 * A pending or partially migrated record must not be marked as tier-ready.
 */
export type ExampleDifficulty = "easy" | "medium" | "yds";
export type LeveledExample = {
  sentence: string;
  translation: string;
  translationFocus?: string[];
  difficulty?: ExampleDifficulty;
};

const expected = { easy: 2, medium: 1, yds: 2 } as const;

export function hasCompleteTierSet(examples: readonly LeveledExample[]): boolean {
  if (examples.length !== 5) return false;
  const count = { easy: 0, medium: 0, yds: 0 };
  const unique = new Set<string>();
  for (const item of examples) {
    if (!item || !item.sentence?.trim() || !item.translation?.trim()) return false;
    if (item.difficulty !== "easy" && item.difficulty !== "medium" && item.difficulty !== "yds") return false;
    if (item.translationFocus?.some(x => !item.translation.includes(x))) return false;
    const key = item.sentence.trim().toLocaleLowerCase("en");
    if (unique.has(key)) return false;
    unique.add(key);
    count[item.difficulty]++;
  }
  return Object.keys(expected).every(k => count[k as ExampleDifficulty] === expected[k as ExampleDifficulty]);
}

/** Personal examples may coexist with exactly five validated, tiered
 * examples. Shared lexicon entries still require the STRICT five-item
 * hasCompleteTierSet contract; only user library/game views use this.
 */
export function hasPlayableTierSet(examples: readonly LeveledExample[]): boolean {
  return hasCompleteTierSet(examples.filter(item =>
    item?.difficulty === "easy" || item?.difficulty === "medium" || item?.difficulty === "yds"));
}

function stableSeedHash(seed: string): number {

  let x = 2166136261;
  for (const char of seed) {
    x ^= char.charCodeAt(0);
    x = Math.imul(x, 16777619) >>> 0;
  }
  return x;
}

/** Group context: medium first; after a mistake, easy #1, easy #2, repeat.
 * Final context: only one of the two YDS examples, deterministic across reload.
 * Unknown/legacy input returns undefined; the caller must label it as legacy.
 */
export function chooseTieredExample<T extends LeveledExample>(
  examples: readonly T[],
  phase: "group" | "final",
  attempt: number,
  seed: string,
): T | undefined {
  const active = examples.filter(x => x?.difficulty === "easy" || x?.difficulty === "medium" || x?.difficulty === "yds");
  if (!hasCompleteTierSet(active)) return undefined;
  if (!Number.isSafeInteger(attempt) || attempt < 0) return undefined;
  if (phase === "group") {
    if (attempt === 0) return active.find(x => x.difficulty === "medium");
    const easy = active.filter(x => x.difficulty === "easy");
    return easy[(attempt - 1) % easy.length];
  }
  const yds = active.filter(x => x.difficulty === "yds");
  return yds[(stableSeedHash(seed) + attempt) % yds.length];
}

export function canonicalExampleOrder<T extends LeveledExample>(items: readonly T[]): T[] {
  if (!hasCompleteTierSet(items)) throw new Error("A complete 2 easy / 1 medium / 2 YDS set is required");
  return [
    ...items.filter(x => x.difficulty === "easy"),
    ...items.filter(x => x.difficulty === "medium"),
    ...items.filter(x => x.difficulty === "yds"),
  ];
}
