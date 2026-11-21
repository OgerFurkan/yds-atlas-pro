import { type WordEntry, type WordInput, wordInputSchema } from "@yds-atlas/shared";
import { hasAtlasTiers } from "./tiered-examples";
import { wordKey } from "./word-normalization";

/** Preserve user metadata, score, and all original examples. Never writes data. */
export function mergeLegacyTieredExamples(existing: WordEntry, generated: WordInput): WordInput {
  if (existing.lexicon) throw new Error("Sözlük bağlantılı kelime otomatik değiştirilemez.");
  if (hasAtlasTiers(existing.examples)) throw new Error("Bu kelimenin 2/1/2 örnekleri hazır.");
  if (wordKey(existing.word) !== wordKey(generated.word))
    throw new Error("Üretilen kelime mevcut kayıtla eşleşmiyor.");
  if (!hasAtlasTiers(generated.examples))
    throw new Error("Yapay zekâ geçerli 2/1/2 cümlesi oluşturamadı.");
  const canonical = generated.examples!.slice(0, 5);
  const seen = new Set(canonical.map(item => item.sentence.trim().toLocaleLowerCase("en")));
  if (seen.size !== 5) throw new Error("Tekrarlanan örnekler reddedildi.");
  // Preserve EVERY user-authored example, including a sentence that happens
  // to match a new generated one. Deduplicating by English text would silently
  // discard a user's translation, annotations, or provenance.
  const original = existing.examples;
  const source = wordInputSchema.parse(existing);
  return wordInputSchema.parse({
    ...source,
    // Only examples change; meanings, user score and original examples survive.
    examples: [...canonical, ...original],
  });
}
