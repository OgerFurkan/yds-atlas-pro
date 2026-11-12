import { afterAll, beforeEach, expect, test } from "bun:test";
import { DailyWordGroupsRepository } from "@/features/word-library/api/daily-word-groups-repository";
import { readStorage, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";

const memory = new Map<string, string>();
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => {
      memory.clear();
    },
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size;
    },
  },
});

afterAll(() => {
  if (previousStorage) {
    Object.defineProperty(globalThis, "localStorage", previousStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

let repository: DailyWordGroupsRepository;
beforeEach(() => {
  memory.clear();
  repository = new DailyWordGroupsRepository();
});

type Group = { day: number; words: string[] };

function seed(groups: Group[]): void {
  // Test, uygulamanın kullandığı storage anahtarını ve yardımcısını kullanır.
  writeStorage(storageKeys.dailyWordGroups, groups);
}

function stored(): Group[] {
  return readStorage<Group[]>(storageKeys.dailyWordGroups, []);
}

test("atanmamış kelime istenen güne eklenir", () => {
  repository.assignWordToDay("word1", 1);
  expect(repository.getGroups()).toEqual([{ day: 1, words: ["word1"] }]);
});

test("aynı güne iki kez eklemek mükerrer kelime oluşturmaz", () => {
  repository.assignWordToDay("word1", 1);
  const before = JSON.stringify(stored());
  repository.assignWordToDay("word1", 1);
  expect(repository.getGroups()).toEqual([{ day: 1, words: ["word1"] }]);
  expect(JSON.stringify(stored())).toBe(before);
});

test("başka güne assign yapmak mevcut atamayı taşımaz", () => {
  repository.assignWordToDay("word1", 1);
  repository.assignWordToDay("word2", 2);
  const before = JSON.stringify(stored());
  repository.assignWordToDay("word1", 2);
  expect(repository.getGroups()).toEqual([
    { day: 1, words: ["word1"] },
    { day: 2, words: ["word2"] },
  ]);
  expect(JSON.stringify(stored())).toBe(before);
});

test("hedef gün zaten varsa yeni kelime aynı gruba eklenir", () => {
  repository.assignWordToDay("a", 2);
  repository.assignWordToDay("b", 2);
  expect(repository.getGroups()).toEqual([{ day: 2, words: ["a", "b"] }]);
});

test("yeni günler gün numarasına göre sıralanır", () => {
  repository.assignWordToDay("a", 20);
  repository.assignWordToDay("b", 2);
  expect(repository.getGroups().map((group) => group.day)).toEqual([2, 20]);
});

test("gün 1 ile 60 arasında tam sayı olmalıdır", () => {
  for (const day of [0, 61, -1, 1.5, NaN, Infinity]) {
    repository.assignWordToDay("word1", day);
  }
  expect(repository.getGroups()).toEqual([]);
  repository.assignWordToDay("word1", 60);
  expect(repository.getGroups()).toEqual([{ day: 60, words: ["word1"] }]);
});

test("boş kelime ID'si kabul edilmez", () => {
  repository.assignWordToDay("  ", 1);
  expect(repository.getGroups()).toEqual([]);
});

test("aynı günde en çok 40 kelime olabilir", () => {
  // 39 ayrı gün kaydı değil, tek günün içinde 39 kelime oluştur.
  seed([{ day: 1, words: Array.from({ length: 39 }, (_, i) => `word${i}`) }]);
  repository.assignWordToDay("word39", 1);
  expect(repository.getGroups()[0].words).toHaveLength(40);
  const before = JSON.stringify(stored());
  repository.assignWordToDay("word40", 1);
  expect(repository.getGroups()[0].words).toHaveLength(40);
  expect(JSON.stringify(stored())).toBe(before);
});

test("geçersiz gün ve çift atama mevcut kayıtları değiştirmez", () => {
  repository.assignWordToDay("word1", 1);
  repository.assignWordToDay("word2", 2);
  const before = JSON.stringify(stored());
  repository.assignWordToDay("word3", 999);
  repository.assignWordToDay("word1", 2);
  repository.assignWordToDay("word1", 1);
  expect(JSON.stringify(stored())).toBe(before);
});

test("removeWordFromDay doğru kelimeyi çıkarır, diğerlerini korur", () => {
  repository.assignWordToDay("word1", 1);
  repository.assignWordToDay("word2", 1);
  repository.assignWordToDay("word3", 2);
  repository.removeWordFromDay("word1");
  expect(repository.getGroups()).toEqual([
    { day: 1, words: ["word2"] },
    { day: 2, words: ["word3"] },
  ]);
});

test("removeWordFromDay opsiyonel gün ile sadece belirtilen günü hedefler", () => {
  repository.assignWordToDay("word1", 1);
  repository.removeWordFromDay("word1", 2);
  expect(repository.getGroups()).toEqual([{ day: 1, words: ["word1"] }]);
});

test("son kelime silinirse boş grup kaldırılır", () => {
  repository.assignWordToDay("word1", 1);
  repository.removeWordFromDay("word1");
  expect(repository.getGroups()).toEqual([]);
});

test("taşıma yalnızca moveWordToDay ile gerçekleşir", () => {
  repository.assignWordToDay("word1", 1);
  repository.assignWordToDay("word2", 2);
  repository.moveWordToDay("word1", 1, 2);
  expect(repository.getGroups()).toEqual([{ day: 2, words: ["word2", "word1"] }]);
});

test("boş hedefe taşıma yeni grup açar", () => {
  repository.assignWordToDay("word1", 1);
  repository.assignWordToDay("word2", 1);
  repository.moveWordToDay("word1", 1, 3);
  expect(repository.getGroups()).toEqual([
    { day: 1, words: ["word2"] },
    { day: 3, words: ["word1"] },
  ]);
});

test("yanlış kaynak gün belirtilirse kelime taşınmaz", () => {
  repository.assignWordToDay("word1", 1);
  repository.moveWordToDay("word1", 2, 3);
  expect(repository.getGroups()).toEqual([{ day: 1, words: ["word1"] }]);
});

test("hedef gün doluysa taşıma veri kaybı oluşturmaz", () => {
  seed([
    { day: 1, words: ["source"] },
    { day: 2, words: Array.from({ length: 40 }, (_, i) => `word${i}`) },
  ]);
  const before = JSON.stringify(stored());
  repository.moveWordToDay("source", 1, 2);
  expect(JSON.stringify(stored())).toBe(before);
});

test("geçersiz taşıma günlerinde kayıtlar korunur", () => {
  repository.assignWordToDay("word1", 1);
  const before = JSON.stringify(stored());
  repository.moveWordToDay("word1", 1, 0);
  repository.moveWordToDay("word1", 1, 61);
  repository.moveWordToDay("word1", 1, 1.5);
  expect(JSON.stringify(stored())).toBe(before);
});

test("yeni repository örneği kayıtları yeniden okuyabilir", () => {
  repository.assignWordToDay("word1", 5);
  const reloaded = new DailyWordGroupsRepository();
  expect(reloaded.getGroups()).toEqual([{ day: 5, words: ["word1"] }]);
});

test("cleanup geçersiz günleri, boş ve tekrar eden ID'leri temizler", () => {
  seed([
    { day: 2, words: ["a", "b", "a", " "] },
    { day: 0, words: ["invalid"] },
    { day: 3, words: ["a", "c"] },
    { day: 61, words: ["invalid2"] },
  ]);
  repository.cleanupInvalidAssignments();
  expect(repository.getGroups()).toEqual([
    { day: 2, words: ["a", "b"] },
    { day: 3, words: ["c"] },
  ]);
});

test("cleanup geçerli kelime ID listesi verilirse silinmiş kelimeleri temizler", () => {
  seed([{ day: 1, words: ["existing", "deleted"] }]);
  repository.cleanupInvalidAssignments(new Set(["existing"]));
  expect(repository.getGroups()).toEqual([{ day: 1, words: ["existing"] }]);
});

test("yeni kelimeler sırayla hedef dolunca sonraki güne atanır", () => {
  const ids = Array.from({ length: 23 }, (_, index) => `new-${index}`);
  repository.syncWords(ids, 20);
  expect(repository.getGroups()).toEqual([
    { day: 1, words: ids.slice(0, 20) },
    { day: 2, words: ids.slice(20) },
  ]);
  const snapshot = JSON.stringify(repository.getGroups());
  repository.syncWords(ids, 10);
  expect(JSON.stringify(repository.getGroups())).toBe(snapshot);
});

test("plandan çıkarılan kelime kütüphanede kalsa da yeniden otomatik atanmaz", () => {
  repository.syncWords(["a", "b", "c"], 20);
  repository.excludeWordFromDay("b", 1);
  repository.syncWords(["a", "b", "c", "d"], 20);
  expect(repository.getGroups()[0].words).toEqual(["a", "c", "d"]);
  expect(repository.getExcludedWordIds()).toContain("b");
  repository.assignWordToDay("b", 4);
  expect(repository.getExcludedWordIds()).not.toContain("b");
  expect(repository.getGroups().find((group) => group.day === 4)?.words).toEqual(["b"]);
});

test("günler arası manuel taşıma sonraki kelime eklemelerinde ve yeniden yüklemede sabit kalır", () => {
  repository.syncWords(["a", "b", "c"], 20);
  repository.moveWordToDay("b", 1, 5);
  const reloaded = new DailyWordGroupsRepository();
  reloaded.syncWords(["a", "b", "c", "d"], 20);
  expect(reloaded.getGroups().find((group) => group.day === 5)?.words).toEqual(["b"]);
  expect(reloaded.getGroups().find((group) => group.day === 1)?.words).toEqual(["a", "c", "d"]);
});

test("kütüphaneden silinen kelimenin eski günlük ataması temizlenir", () => {
  repository.syncWords(["a", "b", "c"], 20);
  repository.syncWords(["a", "c"], 20);
  expect(repository.getGroups()[0].words).toEqual(["a", "c"]);
});
