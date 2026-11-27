import {
  mergeWordEdit,
  type WordEdit,
  type WordEntry,
  type WordInput,
  wordEditSchema,
  wordEntrySchema,
  wordInputSchema,
} from "@yds-atlas/shared";
import { enrichWordInput } from "@yds-atlas/shared/starter-vocabulary";
import {
  commitLocalChanges,
  readStoredJson,
  readStoredText,
  writeStorage,
} from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { getStorageScope, scopedStorageKey, storageGeneration } from "@/shared/lib/storage-scope";
import { normalizeWord, wordKey } from "../model/word-normalization";
import { DailyWordGroupsRepository } from "./daily-word-groups-repository";
import { WordEditConflict, WordEditLockUnavailable, type WordRepository } from "./word-repository";

const storageKey = storageKeys.words;

/** Serialize the guest library's read/modify/write operations across tabs. */
export async function withLocalWordWrite<T>(write: () => T): Promise<T> {
  const generation = storageGeneration();
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request !== "function") {
    throw new WordEditLockUnavailable();
  }
  return locks.request(scopedStorageKey(storageKey), () => {
    if (storageGeneration() !== generation)
      throw new Error("Hesap değişti. İşlemi yeniden başlat.");
    return commitLocalChanges(write);
  });
}

function nextRevision(previous: string) {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

export class MissingLocalWordsWithPlanSettings extends Error {
  constructor() {
    super("Kelime kaydı eksik. Bu profilde yalnızca eski plan ayarları bulundu.");
  }
}

function readWords(confirmEmpty = false) {
  const raw = readStoredJson(storageKey);
  if (raw === undefined) {
    const related = [
      storageKeys.dailyWordGroups,
      storageKeys.dailyWordExclusions,
      storageKeys.dailyProgress,
      storageKeys.completedDays,
      storageKeys.goalPerDay,
      storageKeys.gameSession,
    ];
    if (related.some((key) => readStoredText(key) !== null))
      throw new Error(
        "Kelime kaydı eksik ancak plan veya öğrenme kayıtların duruyor. Kelime kaydını geri yükleyip yeniden dene.",
      );
    // The daily goal is a preference and can be set before the first word.
    // Older plans also wrote the initialization marker with an empty library.
    // A missing word key with only plan settings still requires confirmation.
    const initialized = readStoredJson(storageKeys.dailyPlanInitialized);
    if (initialized !== undefined && typeof initialized !== "boolean")
      throw new Error("Günlük planın başlangıç kaydı geçersiz. Özgün kayıt korundu.");
    const groupSize = new DailyWordGroupsRepository().getStoredGroupSize();
    if ((initialized !== undefined || groupSize !== undefined) && !confirmEmpty)
      throw new MissingLocalWordsWithPlanSettings();
    return { entries: [], raw: [], missing: true };
  }
  const parsed = wordEntrySchema.array().safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.some((word) => !word.id.trim()) ||
    new Set(parsed.data.map((word) => word.id)).size !== parsed.data.length
  )
    throw new Error("Kelime kaydının biçimi geçersiz. Özgün kayıt korundu.");
  return {
    entries: parsed.data,
    raw: raw as (Record<string, unknown> & Pick<WordEntry, "id" | "updatedAt">)[],
    missing: false,
  };
}

function list(): WordEntry[] {
  return readWords().entries;
}

export function initializeEmptyLibrary() {
  if (readWords().missing) writeStorage(storageKey, []);
}

export function recoverEmptyLibrary() {
  if (getStorageScope() !== null)
    throw new Error("Bu işlem yalnızca misafir profilinde kullanılabilir.");
  if (readWords(true).missing) writeStorage(storageKey, []);
}

function save(input: WordInput, id?: string, expectedUpdatedAt?: string) {
  const { entries, raw } = readWords();
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
    previous
      ? raw.map((entry) => (entry.id === id ? { ...entry, ...saved } : entry))
      : [saved, ...raw],
  );
  return saved;
}

interface LocalWordRepository extends WordRepository {
  applyScores(updates: { id: string; score: number }[]): void;
}

export const localWordRepository = {
  list,
  save,
  edit(patch: WordEdit, id: string, expectedUpdatedAt: string) {
    const { raw, entries } = readWords();
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
  applyScores(updates) {
    const scores = new Map(
      updates.map((update) => [update.id, Math.max(0, Math.min(100, Math.round(update.score)))]),
    );
    writeStorage(
      storageKey,
      readWords().raw.map((word) => {
        const score = scores.get(word.id);
        return score === undefined || score === word.score
          ? word
          : { ...word, score, updatedAt: nextRevision(word.updatedAt) };
      }),
    );
  },
  addMany(inputs: WordInput[]) {
    const { entries, raw } = readWords();
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
    writeStorage(storageKey, [...added, ...raw]);
    return { added: added.length, duplicates };
  },
  removeMany(ids: string[]) {
    const removed = new Set(ids);
    writeStorage(
      storageKey,
      readWords().raw.filter((entry) => !removed.has(entry.id)),
    );
  },
} satisfies LocalWordRepository;
