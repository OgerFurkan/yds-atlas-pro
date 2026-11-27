import type { aiWordSchema } from "@yds-atlas/shared";
import type { z } from "zod";

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLocaleLowerCase("en");
}

// Examples may use a regular inflection of the headword (expand → expanded/expanding)
// even when the model forgot to list that form in alternatives.
function formVariants(form: string) {
  const lower = escaped(form);
  const last = lower.at(-1) ?? "";
  const variants = [`${lower}(?:s|es|ed|d|ing|'s|s'|er|est)?`, `${lower}${last}(?:ed|ing|er|est)`];
  if (lower.endsWith("e")) variants.push(`${lower.slice(0, -1)}(?:ing|ed|es|er|ers|est)`);
  if (/[^aeiou]y$/.test(lower)) variants.push(`${lower.slice(0, -1)}(?:ies|ied|ier|iest|ying)`);
  return variants;
}

export function containsHeadword(sentence: string, forms: string[]) {
  const pattern = new RegExp(
    "(^|[^a-z])(?:" + forms.flatMap(formVariants).join("|") + ")(?![a-z])",
    "i",
  );
  return pattern.test(sentence);
}

export function validExamples(suggestion: z.infer<typeof aiWordSchema>) {
  const forms = [suggestion.word, ...suggestion.alternatives];
  const tiers = ["easy", "easy", "medium", "yds", "yds"];
  const hasLabels = suggestion.examples.some((example) => example.difficulty !== undefined);
  return (
    (!hasLabels ||
      suggestion.examples.every((example, index) => example.difficulty === tiers[index])) &&
    suggestion.examples.every(
      (example) =>
        containsHeadword(example.sentence, forms) &&
        example.translationFocus.every((focus) => example.translation.includes(focus)),
    ) &&
    new Set(suggestion.examples.map((example) => example.sentence.trim().toLocaleLowerCase("en")))
      .size === suggestion.examples.length
  );
}
