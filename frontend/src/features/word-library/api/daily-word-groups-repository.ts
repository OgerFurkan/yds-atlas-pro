import { readStorage, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";

const STORAGE_KEY = storageKeys.dailyWordGroups;
const MAX_DAY = 60;
const MAX_WORDS_PER_DAY = 40;

export interface DailyWordGroup {
  day: number;
  words: string[];
}

function isDailyWordGroup(value: unknown): value is DailyWordGroup {
  if (value === null || typeof value !== "object") return false;
  const item = value as { day?: unknown; words?: unknown };
  return (
    typeof item.day === "number" &&
    Array.isArray(item.words) &&
    item.words.every((id: unknown) => typeof id === "string")
  );
}

function isValidDay(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= MAX_DAY;
}

export class DailyWordGroupsRepository {
  private getStoredGroups(): DailyWordGroup[] {
    try {
      const value = readStorage<unknown>(STORAGE_KEY, []);
      if (!Array.isArray(value)) return [];
      return value
        .filter(isDailyWordGroup)
        .map((group) => ({ day: group.day, words: [...group.words] }));
    } catch {
      return [];
    }
  }

  private saveGroups(groups: DailyWordGroup[]): void {
    // Depolama hatasını sessizce yutma; çağıran katman hatayı yönetebilsin.
    writeStorage(STORAGE_KEY, groups);
  }

  private sortGroupsByDay(groups: DailyWordGroup[]): DailyWordGroup[] {
    return [...groups].sort((a, b) => a.day - b.day);
  }

  getGroups(): DailyWordGroup[] {
    return this.sortGroupsByDay(this.getStoredGroups());
  }

  assignWordToDay(wordId: string, day: number): void {
    if (!isValidDay(day) || typeof wordId !== "string" || !wordId.trim()) {
      return;
    }

    const groups = this.getStoredGroups();

    // Kelime zaten herhangi bir günde varsa işlem yapma.
    // Farklı güne taşıma yalnızca moveWordToDay ile yapılır.
    if (groups.some((group) => group.words.includes(wordId))) {
      return;
    }

    const targetGroup = groups.find((group) => group.day === day);
    if (targetGroup) {
      if (targetGroup.words.length >= MAX_WORDS_PER_DAY) return;
      targetGroup.words.push(wordId);
    } else {
      groups.push({ day, words: [wordId] });
    }

    this.saveGroups(this.sortGroupsByDay(groups));
  }

  // Geriye uyumlu: day verilmezse kelimenin bulunduğu gruptan çıkarılır.
  // day verilirse sadece belirtilen gün hedeflenir.
  removeWordFromDay(wordId: string, day?: number): void {
    if (typeof wordId !== "string" || !wordId.trim()) return;
    if (day !== undefined && !isValidDay(day)) return;

    const groups = this.getStoredGroups();
    let changed = false;
    const updated = groups
      .map((group) => {
        if (day !== undefined && group.day !== day) return group;
        const remaining = group.words.filter((id) => id !== wordId);
        if (remaining.length !== group.words.length) changed = true;
        return { day: group.day, words: remaining };
      })
      .filter((group) => group.words.length > 0);

    if (!changed) return;
    this.saveGroups(this.sortGroupsByDay(updated));
  }

  moveWordToDay(wordId: string, fromDay: number, toDay: number): void {
    if (
      typeof wordId !== "string" ||
      !wordId.trim() ||
      !isValidDay(fromDay) ||
      !isValidDay(toDay) ||
      fromDay === toDay
    ) {
      return;
    }

    const groups = this.getStoredGroups();
    const sourceGroup = groups.find((group) => group.day === fromDay);
    if (!sourceGroup?.words.includes(wordId)) return;

    // Var olan bozuk atamalar üzerinde işlem yapıp çakışmayı büyütme.
    if (groups.some((group) => group.day !== fromDay && group.words.includes(wordId))) {
      return;
    }

    const targetGroup = groups.find((group) => group.day === toDay);
    if (targetGroup && targetGroup.words.length >= MAX_WORDS_PER_DAY) {
      return;
    }

    // Bütün doğrulamalar geçtikten sonra tek kayıt işlemiyle taşı.
    sourceGroup.words = sourceGroup.words.filter((id) => id !== wordId);
    if (targetGroup) {
      targetGroup.words.push(wordId);
    } else {
      groups.push({ day: toDay, words: [wordId] });
    }

    this.saveGroups(this.sortGroupsByDay(groups.filter((group) => group.words.length > 0)));
  }

  // validWordIds sağlanırsa kütüphaneden silinmiş kelimeler de temizlenir.
  // Bu liste verilmezse hangi ID'nin kütüphanede bulunduğu bilinemez.
  cleanupInvalidAssignments(validWordIds?: ReadonlySet<string>): void {
    const groups = this.getStoredGroups();
    const byDay = new Map<number, string[]>();
    const assignedWordIds = new Set<string>();

    for (const group of this.sortGroupsByDay(groups)) {
      if (!isValidDay(group.day)) continue;
      const words = byDay.get(group.day) ?? [];

      for (const wordId of group.words) {
        if (!wordId.trim()) continue;
        if (validWordIds && !validWordIds.has(wordId)) continue;
        if (assignedWordIds.has(wordId)) continue;
        assignedWordIds.add(wordId);
        words.push(wordId);
      }

      if (words.length > 0) byDay.set(group.day, words);
    }

    // Mevcut veride 40 kelimeyi aşan kayıtları sessizce silmiyoruz.
    // Yeni atama ve taşıma işlemleri 40 sınırını korumaya devam eder.
    const cleaned = [...byDay].map(([day, words]) => ({ day, words }));
    if (JSON.stringify(groups) !== JSON.stringify(cleaned)) {
      this.saveGroups(cleaned);
    }
  }
}
