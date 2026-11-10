import {
  type WordEntry,
  type WordInput,
  wordEntrySchema,
  wordInputSchema,
} from "@yds-atlas/shared";
import { readStorage, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { enrichWordInput } from "../data/starter-vocabulary";
import { normalizeWord, wordKey } from "../model/word-normalization";
import type { WordRepository } from "./word-repository";

const storageKey = storageKeys.words;

function list(): WordEntry[] {
  const entries = readStorage<WordEntry[]>(storageKey, []);
  const parsed = wordEntrySchema.array().safeParse(entries);
  if (!parsed.success) throw new Error("Kelime kaydı okunamadı.");
  return parsed.data;
}

function save(input: WordInput, id?: string) {
  const entries = list();
  const data = wordInputSchema.parse({
    ...enrichWordInput(input),
    word: normalizeWord(input.word),
  });
  if (id && !entries.some((entry) => entry.id === id)) throw new Error("Kelime bulunamadı.");
  if (entries.some((entry) => entry.id !== id && wordKey(entry.word) === wordKey(data.word)))
    throw new Error("Bu kelime kütüphanende zaten var.");
  const now = new Date().toISOString();
  const previous = entries.find((entry) => entry.id === id);
  const saved: WordEntry = {
    ...data,
    id: id ?? crypto.randomUUID(),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  writeStorage(
    storageKey,
    previous ? entries.map((entry) => (entry.id === id ? saved : entry)) : [saved, ...entries],
  );
  return saved;
}

export const localWordRepository = {
  list,
  save,
  applyScores(updates: { id: string; score: number }[]) {
    const scores = new Map(
      updates.map((update) => [update.id, Math.max(0, Math.min(100, Math.round(update.score)))]),
    );
    const now = new Date().toISOString();
    writeStorage(
      storageKey,
      list().map((word) => {
        const score = scores.get(word.id);
        return score === undefined ? word : { ...word, score, updatedAt: now };
      }),
    );
  },
  addMany(inputs: WordInput[]) {
    const entries = list();
    const keys = new Set(entries.map((entry) => wordKey(entry.word)));
    const now = new Date().toISOString();
    const added: WordEntry[] = [];
    let duplicates = 0;
    for (const input of inputs) {
      const data = wordInputSchema.parse({
        ...enrichWordInput(input),
        word: normalizeWord(input.word),
      });
      const key = wordKey(data.word);
      if (keys.has(key)) {
        duplicates += 1;
        continue;
      }
      keys.add(key);
      added.push({ ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now });
    }
    writeStorage(storageKey, [...added, ...entries]);
    return { added: added.length, duplicates };
  },
  removeMany(ids: string[]) {
    const removed = new Set(ids);
    writeStorage(
      storageKey,
      list().filter((entry) => !removed.has(entry.id)),
    );
  },
} satisfies WordRepository;
