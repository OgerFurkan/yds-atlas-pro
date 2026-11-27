import type { editorialItem } from "@yds-atlas/shared";
import type { z } from "zod";

export type EditorialDraftItem = z.infer<typeof editorialItem>;

// The editor accepts incomplete inputs until the submission applies the domain schema.
export function editableDraftItems(draft: string): EditorialDraftItem[] {
  try {
    const parsed = JSON.parse(draft);
    if (
      Array.isArray(parsed) &&
      parsed.length <= 20 &&
      parsed.every(
        (v) =>
          v &&
          typeof v.content?.word === "string" &&
          typeof v.content.partOfSpeech === "string" &&
          typeof v.content.usageNote === "string" &&
          Array.isArray(v.content.meanings) &&
          v.content.meanings.every((m: unknown) => typeof m === "string") &&
          Array.isArray(v.content.examples) &&
          v.content.examples.length === 5 &&
          v.content.examples.every(
            (ex: EditorialDraftItem["content"]["examples"][number]) =>
              ex &&
              typeof ex.sentence === "string" &&
              typeof ex.translation === "string" &&
              Array.isArray(ex.translationFocus) &&
              ex.translationFocus.every((f) => typeof f === "string"),
          ),
      )
    )
      return parsed;
  } catch {
    /* The raw editor can contain an unfinished edit. */
  }
  return [];
}
