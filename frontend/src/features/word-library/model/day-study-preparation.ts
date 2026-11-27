import {
  matchesRequestedSense,
  type WordEntry,
  type WordInput,
  wordInputSchema,
} from "@yds-atlas/shared";
import { usableExamples } from "@/features/learning-game/model/game-engine";
import { missingStudyContent } from "./daily-groups";
import { hasAtlasTiers } from "./tiered-examples";
import { wordKey } from "./word-normalization";

export function mergeDayStudyWord(existing: WordEntry, source: WordInput): WordInput | null {
  if (existing.lexicon || wordKey(existing.word) !== wordKey(source.word)) return null;
  const candidate = wordInputSchema.parse(source);
  if (!candidate.partOfSpeech || !candidate.meanings.length || !hasAtlasTiers(candidate.examples))
    return null;
  if (!matchesRequestedSense(existing, candidate)) return null;
  const canonical = candidate.examples.slice(0, 5);
  if (usableExamples({ ...existing, examples: canonical }).length !== 5) return null;
  if (new Set(canonical.map(({ sentence }) => sentence.trim().toLowerCase())).size !== 5)
    return null;
  const input = wordInputSchema.parse({
    ...existing,
    attribution: existing.attribution ?? candidate.attribution,
    usageNote: existing.usageNote || candidate.usageNote,
    cefr: existing.cefr === "Belirtilmedi" ? candidate.cefr : existing.cefr,
    alternatives: [...new Set([...existing.alternatives, ...candidate.alternatives])],
    pronunciationUk: existing.pronunciationUk || candidate.pronunciationUk,
    pronunciationUs: existing.pronunciationUs || candidate.pronunciationUs,
    sourceUrl: existing.sourceUrl || candidate.sourceUrl,
    meanings: existing.meanings.some((meaning) => meaning.trim())
      ? existing.meanings
      : candidate.meanings,
    partOfSpeech: existing.partOfSpeech || candidate.partOfSpeech,
    examples:
      hasAtlasTiers(existing.examples) &&
      usableExamples({ ...existing, examples: existing.examples.slice(0, 5) }).length === 5
        ? existing.examples
        : [...canonical, ...existing.examples],
  });
  return !missingStudyContent({ ...existing, ...input }).length ? input : null;
}
