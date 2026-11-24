import { type WordEntry, type WordInput, wordInputSchema } from "@yds-atlas/shared";
import { usableExamples } from "@/features/learning-game/model/game-engine";
import { isDayStudyReady } from "./daily-groups";
import { hasAtlasTiers } from "./tiered-examples";
import { wordKey } from "./word-normalization";

export function mergeDayStudyWord(existing: WordEntry, source: WordInput): WordInput | null {
  if (existing.lexicon || wordKey(existing.word) !== wordKey(source.word)) return null;
  const candidate = wordInputSchema.parse(source);
  if (!candidate.partOfSpeech || !candidate.meanings.length || !hasAtlasTiers(candidate.examples))
    return null;
  if (
    existing.partOfSpeech.trim() &&
    wordKey(existing.partOfSpeech) !== wordKey(candidate.partOfSpeech)
  )
    return null;
  const canonical = candidate.examples.slice(0, 5);
  if (usableExamples({ ...existing, examples: canonical }).length !== 5) return null;
  if (new Set(canonical.map(({ sentence }) => sentence.trim().toLowerCase())).size !== 5)
    return null;
  const input = wordInputSchema.parse({
    ...existing,
    meanings: existing.meanings.some((meaning) => meaning.trim())
      ? existing.meanings
      : candidate.meanings,
    partOfSpeech: existing.partOfSpeech || candidate.partOfSpeech,
    examples:
      usableExamples(existing).length >= 5
        ? existing.examples
        : [...canonical, ...existing.examples],
  });
  return isDayStudyReady({ ...existing, ...input }) ? input : null;
}
