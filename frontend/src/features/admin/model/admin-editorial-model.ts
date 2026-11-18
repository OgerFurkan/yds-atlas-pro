import type { EditorialStatus, EditorialSummary, EditorialReason } from "../api/admin-editorial-api";

export const STATUS_LABELS: Record<EditorialStatus, string> = {
  machine_validated: "Makine kontrolü",
  human_reviewed: "Editör onaylı",
  quarantined: "Karantina",
};
export const REASON_LABELS: Record<EditorialReason, string> = {
  incorrect_sense: "Yanlış sözcük türü veya anlam",
  quality: "Yetersiz örnek veya çeviri kalitesi",
  unsafe: "Uygun olmayan içerik",
  other: "Diğer kalite sorunu",
};

/** Display-only hint. The backend rechecks the complete record and uses CAS. */
export function permittedEditorialActions(row: Pick<EditorialSummary, "status" | "revision">) {
  return {
    approve: row.status === "machine_validated" && Number.isSafeInteger(row.revision) && row.revision > 0,
    quarantine: row.status !== "quarantined" && Number.isSafeInteger(row.revision) && row.revision > 0,
  };
}

export function normalizeEditorialSearch(value: string): string | null {
  const word = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
  if (word === "") return "";
  return word.length <= 120 && /^[a-z]+(?:[ '-][a-z]+)*$/.test(word) ? word : null;
}

export function countExampleTiers(examples: readonly { difficulty?: string }[]) {
  return examples.reduce((count, example) => {
    if (example.difficulty === "easy") count.easy++;
    if (example.difficulty === "medium") count.medium++;
    if (example.difficulty === "yds") count.yds++;
    return count;
  }, { easy: 0, medium: 0, yds: 0 });
}

/** Binds a review intent to the exact entry and revision the administrator inspected. */
export type EditorialDecision = (
  { nextStatus: "human_reviewed"; reasonCode: "editorial_approved" } |
  { nextStatus: "quarantined"; reasonCode: EditorialReason }
) & { id: string; revision: number; word: string };

export function isCurrentEditorialDecision(
  intent: EditorialDecision | null,
  entry: Pick<EditorialSummary, "id" | "revision" | "word"> | null | undefined,
): boolean {
  return !!intent && !!entry &&
    intent.id === entry.id && intent.word === entry.word &&
    Number.isSafeInteger(intent.revision) && intent.revision > 0 &&
    intent.revision === entry.revision;
}

export type EditorialResult = { id: string; kind: "success" | "error"; message: string };

/** A late network result must never appear on a different selected entry. */
export function resultForEditorialEntry(result: EditorialResult | null, entryId: string) {
  return result?.id === entryId ? result : null;
}
