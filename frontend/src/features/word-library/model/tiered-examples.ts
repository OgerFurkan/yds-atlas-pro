/** Canonical order for every newly prepared Atlas word; never label arbitrary text as YDS. */
export const ATLAS_TIER_ORDER = ["easy", "easy", "medium", "yds", "yds"] as const;
export type AtlasTierExample = {
  sentence?: string;
  translation?: string;
  translationFocus?: readonly string[];
  difficulty?: string;
};
export function hasAtlasTiers(examples: readonly AtlasTierExample[] | undefined): boolean {
  return Array.isArray(examples) && examples.length === ATLAS_TIER_ORDER.length &&
    examples.every((example, index) =>
      example.difficulty === ATLAS_TIER_ORDER[index] &&
      typeof example.sentence === "string" && example.sentence.trim().length > 0 &&
      typeof example.translation === "string" && example.translation.trim().length > 0 &&
      Array.isArray(example.translationFocus) && example.translationFocus.length > 0 &&
      example.translationFocus.every((part: string) => typeof part === "string" &&
        part.trim().length > 0 && example.translation!.includes(part))
    );
}
