import { createHash } from "node:crypto";

const POS = new Set([
  "Noun",
  "Verb",
  "Adjective",
  "Adverb",
  "Preposition",
  "Conjunction",
  "Pronoun",
  "Phrase",
  "Article",
  "Determiner",
  "Modal Verb",
  "Auxiliary Verb",
  "Numeral",
  "Interjection",
]);
const TIERS = ["easy", "easy", "medium", "yds", "yds"] as const;
export type InspectorQuery = { word: string; partOfSpeech?: string; meaning?: string };
export type Level = "easy" | "medium" | "yds";
export type Example = {
  sentence: string;
  translation: string;
  difficulty: Level;
  translationFocus: string[];
};
export type Content = {
  word: string;
  partOfSpeech: string;
  meanings: string[];
  alternatives: string[];
  usageNote: string;
  cefr: string;
  examples: Example[];
  ipaUk?: string;
  ipaUs?: string;
  pronunciationUk?: string;
  pronunciationUs?: string;
};
export type EntryRow = {
  provenance?: { license?: string; source?: string; attribution?: string };
  id: string;
  word_key: string;
  part_of_speech: string;
  sense_key: string;
  revision: number;
  status: string;
  content: Content;
};

function norm(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function canonicalQuery(query: InspectorQuery) {
  const word = norm(query.word).toLocaleLowerCase("en");
  if (word.length > 120 || !/^[a-z]+(?:[ '-][a-z]+)*$/.test(word)) {
    throw new Error("INVALID_WORD");
  }
  const part = query.partOfSpeech;
  if (part !== undefined && !POS.has(part)) throw new Error("INVALID_POS");
  const meaning = query.meaning === undefined ? undefined : norm(query.meaning);
  if (meaning !== undefined && (!part || meaning.length < 1 || meaning.length > 200)) {
    throw new Error("INVALID_SENSE");
  }
  return { word, partOfSpeech: part, meaning };
}

export function meaningKey(value: string) {
  return createHash("sha256").update(norm(value).toLocaleLowerCase("tr")).digest("hex");
}

export function validEntry(row: EntryRow): boolean {
  const content = row?.content;
  if (
    !row ||
    !content ||
    !["machine_validated", "human_reviewed"].includes(row.status) ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !POS.has(row.part_of_speech) ||
    !Array.isArray(content.meanings) ||
    content.meanings.length < 1 ||
    content.meanings.length > 4 ||
    !Array.isArray(content.alternatives) ||
    content.alternatives.length > 20 ||
    !content.alternatives.every((value) => typeof value === "string" && value.length <= 120) ||
    !Array.isArray(content.examples) ||
    content.examples.length !== 5 ||
    typeof content.word !== "string" ||
    typeof content.partOfSpeech !== "string" ||
    typeof content.usageNote !== "string" ||
    content.usageNote.length > 2000 ||
    !["A1", "A2", "B1", "B2", "C1", "C2", "Belirtilmedi"].includes(content.cefr) ||
    [content.ipaUk, content.ipaUs].some(
      (v) => v !== undefined && (typeof v !== "string" || v.length > 120),
    ) ||
    (content.pronunciationUk !== undefined &&
      (typeof content.pronunciationUk !== "string" || content.pronunciationUk.length > 200)) ||
    (content.pronunciationUs !== undefined &&
      (typeof content.pronunciationUs !== "string" || content.pronunciationUs.length > 200)) ||
    row.word_key !== norm(content.word).toLocaleLowerCase("en") ||
    row.part_of_speech !== content.partOfSpeech ||
    !content.meanings.every(
      (value) => typeof value === "string" && !!value.trim() && value.length <= 200,
    ) ||
    row.sense_key !== meaningKey(content.meanings[0])
  ) {
    return false;
  }
  const seen = new Set<string>();
  return content.examples.every((example, index) => {
    if (
      !example ||
      example.difficulty !== TIERS[index] ||
      typeof example.sentence !== "string" ||
      !example.sentence.trim() ||
      example.sentence.length > 2000 ||
      typeof example.translation !== "string" ||
      !example.translation.trim() ||
      example.translation.length > 2000 ||
      !Array.isArray(example.translationFocus) ||
      example.translationFocus.length < 1 ||
      example.translationFocus.length > 4 ||
      !example.translationFocus.every(
        (value) =>
          typeof value === "string" && !!value.trim() && example.translation.includes(value),
      )
    ) {
      return false;
    }
    const normalized = norm(example.sentence).toLocaleLowerCase("en");
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    // The featured word (or a declared alternative) must occur as a whole token.
    const forms = [content.word, ...content.alternatives]
      .filter((value) => typeof value === "string" && !!value.trim())
      .map((value) => norm(value).toLocaleLowerCase("en"));
    const tokens = normalized.match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
    const length = tokens.length;
    if (
      (example.difficulty === "easy" && (length < 3 || length > 12)) ||
      (example.difficulty === "medium" && (length < 6 || length > 21)) ||
      (example.difficulty === "yds" && (length < 14 || length > 52))
    ) {
      return false;
    }
    return forms.some((form) =>
      new RegExp(
        "(^|[^a-z])" + form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z]|$)",
        "i",
      ).test(normalized),
    );
  });
}

export function projectEntry(row: EntryRow) {
  if (!validEntry(row)) throw new Error("INVALID_ENTRY");
  const content = row.content;
  return {
    id: row.id,
    word: row.word_key,
    partOfSpeech: row.part_of_speech,
    meaning: content.meanings[0],
    senseKey: row.sense_key,
    revision: row.revision,
    status: row.status,
    meanings: [...content.meanings],
    alternatives: [...content.alternatives],
    usageNote: content.usageNote,
    cefr: content.cefr,
    examples: content.examples.map((example) => ({
      ...example,
      translationFocus: [...example.translationFocus],
    })),
    ...(content.ipaUk ? { ipaUk: content.ipaUk } : {}),
    ...(content.ipaUs ? { ipaUs: content.ipaUs } : {}),
    pronunciationUk: content.pronunciationUk ?? null,
    pronunciationUs: content.pronunciationUs ?? null,
  };
}

export function selectEntries(rows: EntryRow[], query: InspectorQuery) {
  const normalized = canonicalQuery(query);
  const eligible = rows
    .filter(validEntry)
    .filter(
      (row) =>
        row.word_key === normalized.word &&
        (!normalized.partOfSpeech || row.part_of_speech === normalized.partOfSpeech) &&
        (!normalized.meaning || row.sense_key === meaningKey(normalized.meaning)),
    );
  if (eligible.length === 0) return { status: "missing" as const, word: normalized.word };
  if (eligible.length > 1) {
    return {
      status: "choices" as const,
      word: normalized.word,
      choices: eligible.map((row) => {
        const projection = projectEntry(row);
        return {
          id: projection.id,
          word: projection.word,
          partOfSpeech: projection.partOfSpeech,
          meaning: projection.meaning,
          revision: projection.revision,
          status: projection.status,
        };
      }),
    };
  }
  return { status: "ready" as const, word: normalized.word, entry: projectEntry(eligible[0]) };
}
