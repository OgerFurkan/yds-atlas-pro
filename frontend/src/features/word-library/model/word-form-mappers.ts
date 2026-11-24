import { type WordEdit, type WordEntry, type WordInput, wordEditSchema } from "@yds-atlas/shared";
import { emptyWordForm, type WordFormValues } from "./word-form.schema";

function parseList(value: string) {
  return value
    .split(/\n|,/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function toFormValues(word?: WordEntry): WordFormValues {
  if (!word) return emptyWordForm;
  return {
    word: word.word,
    alternatives: word.alternatives.join(", "),
    meanings: word.meanings.join(", "),
    usageNote: word.usageNote,
    partOfSpeech: word.partOfSpeech,
    cefr: word.cefr,
    score: word.score,
    examples: word.examples
      .map((example) =>
        example.translation ? `${example.sentence} | ${example.translation}` : example.sentence,
      )
      .join("\n"),
    sourceUrl: word.sourceUrl,
    pronunciationUk: word.pronunciationUk,
    pronunciationUs: word.pronunciationUs,
  };
}

export function toWordInput(values: WordFormValues, word: string): WordInput {
  return {
    word,
    alternatives: parseList(values.alternatives),
    meanings: parseList(values.meanings),
    usageNote: values.usageNote.trim(),
    partOfSpeech: values.partOfSpeech.trim(),
    cefr: values.cefr,
    score: values.score,
    examples: values.examples
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sentence, ...translation] = line.split("|");
        return {
          sentence: sentence.trim(),
          translation: translation.join("|").trim(),
        };
      }),
    sourceUrl: values.sourceUrl.trim(),
    pronunciationUk: values.pronunciationUk.trim(),
    pronunciationUs: values.pronunciationUs.trim(),
  };
}

/** Editing a word must not strip its validated 2/1/2 tier metadata.
 * Only unchanged sentence+translation pairs retain their original provenance. */
export function preserveExampleMetadata(input: WordInput, source: WordInput): WordInput {
  if (!input.examples?.length || !source.examples?.length) return input;
  return {
    ...input,
    examples: input.examples.map((example) => {
      const original = source.examples?.find(
        (entry) => entry.sentence === example.sentence && entry.translation === example.translation,
      );
      return original
        ? {
            ...example,
            difficulty: original.difficulty,
            translationFocus: original.translationFocus,
            source: original.source,
          }
        : example;
    }),
  };
}

export function editedWordFields(input: WordInput, original: WordEntry, aiSource?: WordInput) {
  const baseline = toWordInput(toFormValues(original), original.word);
  const edited = Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) =>
        Object.hasOwn(wordEditSchema.shape, key) &&
        JSON.stringify(value) !== JSON.stringify(baseline[key as keyof WordInput]),
    ),
  ) as WordEdit;
  if (edited.examples) {
    const preserved = preserveExampleMetadata(input, original);
    edited.examples = aiSource
      ? preserveExampleMetadata(preserved, aiSource).examples
      : preserved.examples;
  }
  return edited;
}
