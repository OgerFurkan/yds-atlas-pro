import type { WordExample } from "@yds-atlas/shared";

/**
 * Preserve provenance and both optional calibration dimensions only for an
 * exact, unambiguous unchanged sentence+translation. A rewrite is new content.
 */
type DraftExample = { sentence: string; translation?: string; purpose?: "practice" | "exam"; difficulty?: "easy" | "medium" | "yds" };

export function restoreExampleMetadata<T extends DraftExample>(
  edited: readonly T[],
  previous: readonly WordExample[],
): T[] {
  return edited.map((item) => {
    const exact = previous.filter(
      (old) => old.sentence === item.sentence && old.translation === (item.translation ?? ""),
    );
    if (exact.length !== 1) return item;
    return {
      ...item,
      translationFocus: exact[0].translationFocus,
      source: exact[0].source,
      purpose: exact[0].purpose,
      difficulty: exact[0].difficulty,
    };
  });
}
