import {
  mergeWordEdit,
  type WordEdit,
  type WordEntry,
  type WordInput,
  wordEditSchema,
  wordEntrySchema,
  wordInputSchema,
} from "@yds-atlas/shared";
import { readStorage, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { getStorageScope, scopedStorageKey } from "@/shared/lib/storage-scope";
import { enrichWordInput } from "../data/starter-vocabulary";
import { normalizeWord, wordKey } from "../model/word-normalization";
import { WordEditConflict, WordEditLockUnavailable, type WordRepository } from "./word-repository";

const storageKey = storageKeys.words;

/** Serialize the guest library's read/modify/write operations across tabs. */
export function withLocalWordWrite<T>(write: () => T, requireLock = false): T | Promise<T> {
  const scope = getStorageScope();
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request !== "function") {
    if (requireLock) throw new WordEditLockUnavailable();
    return write();
  }
  return locks.request(scopedStorageKey(storageKey), () => {
    if (getStorageScope() !== scope) throw new Error("Hesap değişti. İşlemi yeniden başlat.");
    return write();
  });
}

function nextRevision(previous: string) {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

function list(): WordEntry[] {
  const entries = readStorage<WordEntry[]>(storageKey, []);
  const parsed = wordEntrySchema.array().safeParse(entries);
  if (!parsed.success) throw new Error("Kelime kaydı okunamadı.");
  return parsed.data;
}

function save(input: WordInput, id?: string, expectedUpdatedAt?: string) {
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
  if (expectedUpdatedAt && previous?.updatedAt !== expectedUpdatedAt)
    throw new Error("Kelime başka bir oturumda değişti. Önce yenile.");
  const saved: WordEntry = {
    ...data,
    id: id ?? crypto.randomUUID(),
    createdAt: previous?.createdAt ?? now,
    updatedAt: previous ? nextRevision(previous.updatedAt) : now,
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
  edit(patch: WordEdit, id: string, expectedUpdatedAt: string) {
    const raw = readStorage<Record<string, unknown>[]>(storageKey, []);
    const entries = wordEntrySchema.array().parse(raw);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error("Kelime bulunamadı.");
    const current = entries[index];
    if (current.updatedAt !== expectedUpdatedAt) throw new WordEditConflict();
    const changes = wordEditSchema.parse(patch);
    if (changes.word !== undefined) {
      changes.word = normalizeWord(changes.word);
      const key = wordKey(changes.word);
      if (entries.some((entry) => entry.id !== id && wordKey(entry.word) === key))
        throw new Error("Bu kelime kütüphanende zaten var.");
    }
    const next = {
      ...mergeWordEdit(raw[index], changes),
      updatedAt: nextRevision(current.updatedAt),
    };
    const result = wordEntrySchema.parse(next);
    raw[index] = next;
    writeStorage(storageKey, raw);
    return result;
  },
  applyScores(updates: { id: string; score: number }[]) {
    const scores = new Map(
      updates.map((update) => [update.id, Math.max(0, Math.min(100, Math.round(update.score)))]),
    );
    writeStorage(
      storageKey,
      list().map((word) => {
        const score = scores.get(word.id);
        return score === undefined
          ? word
          : { ...word, score, updatedAt: nextRevision(word.updatedAt) };
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
