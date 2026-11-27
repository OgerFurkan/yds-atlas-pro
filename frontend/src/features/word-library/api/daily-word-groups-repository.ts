import { readStoredJson, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { allocateDailyGroups, type DailyWordGroup } from "../model/allocate-daily-groups";

export type { DailyWordGroup } from "../model/allocate-daily-groups";

const STORAGE_KEY = storageKeys.dailyWordGroups;
const MAX_DAY = 60;
const MAX_WORDS_PER_DAY = 40;
const INIT_KEY = storageKeys.dailyPlanInitialized;
const EXCLUDED_KEY = storageKeys.dailyWordExclusions;

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
  private readonly read: (key: string) => unknown;
  private readonly write: (key: string, value: unknown) => void;
  constructor(
    read: (key: string) => unknown = readStoredJson,
    write: (key: string, value: unknown) => void = writeStorage,
  ) {
    this.read = read;
    this.write = write;
  }

  private getStoredGroups(legacyCleanup = false): DailyWordGroup[] {
    const value = this.read(STORAGE_KEY);
    if (value === undefined) return [];
    if (
      !Array.isArray(value) ||
      !value.every(isDailyWordGroup) ||
      (!legacyCleanup &&
        value.some((group) => !isValidDay(group.day) || group.words.some((id) => !id.trim())))
    )
      throw new Error("Günlük plan atamaları doğrulanamadı. Özgün kayıt korundu.");
    return value;
  }

  getStoredGroupSize(): number | undefined {
    const value = this.read(storageKeys.dailyPlanGroupSize);
    if (value === undefined) return undefined;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 10 ||
      value > MAX_WORDS_PER_DAY
    )
      throw new Error("Günlük planın grup boyutu geçersiz. Özgün kayıt korundu.");
    return value;
  }

  private saveGroups(groups: DailyWordGroup[]): void {
    // Depolama hatasını sessizce yutma; çağıran katman hatayı yönetebilsin.
    this.write(STORAGE_KEY, groups);
  }

  private sortGroupsByDay(groups: DailyWordGroup[]): DailyWordGroup[] {
    return [...groups].sort((a, b) => a.day - b.day);
  }

  getGroups(): DailyWordGroup[] {
    return this.sortGroupsByDay(this.getStoredGroups());
  }

  getDayRemoval(day: number, storedGroups = this.getGroups()) {
    const groups = storedGroups.filter((group) => isValidDay(group.day));
    const ids = [
      ...new Set(groups.filter((group) => group.day === day).flatMap((group) => group.words)),
    ].sort();
    const target = new Set(ids);
    const conflicts = [
      ...new Set(
        groups
          .filter((group) => group.day !== day)
          .flatMap((group) => group.words.filter((id) => target.has(id))),
      ),
    ];
    return { ids, conflicts };
  }

  getExcludedWordIds(): string[] {
    const ids = this.read(EXCLUDED_KEY);
    if (ids === undefined) return [];
    if (
      !Array.isArray(ids) ||
      !ids.every((id): id is string => typeof id === "string" && !!id.trim())
    )
      throw new Error("Plandan çıkarılan kelimeler doğrulanamadı. Özgün kayıt korundu.");
    return ids;
  }

  readPlan() {
    const initialized = this.read(INIT_KEY);
    if (initialized !== undefined && typeof initialized !== "boolean")
      throw new Error("Günlük planın başlangıç kaydı geçersiz. Özgün kayıt korundu.");
    return {
      initialized,
      size: this.getStoredGroupSize() ?? 20,
      groups: this.getStoredGroups(),
      exclusions: this.getExcludedWordIds(),
    };
  }

  /**
   * Migrate the former derived day view once, then keep explicit assignments stable.
   * New library words are placed in the first day below the selected target size;
   * deliberately removed words stay unassigned until added again by the user.
   */
  syncWords(
    orderedWordIds: string[],
    targetSize?: number,
    persist = true,
    preserveMissing = false,
  ) {
    const {
      size: storedSize,
      initialized,
      groups: original,
      exclusions: originalExclusions,
    } = this.readPlan();
    const { size, next, excluded } = allocateDailyGroups(
      orderedWordIds,
      original,
      originalExclusions,
      targetSize ?? storedSize,
      preserveMissing,
      MAX_DAY,
      MAX_WORDS_PER_DAY,
    );
    if (!persist) return { size, groups: next };
    if (JSON.stringify(original) !== JSON.stringify(next)) this.saveGroups(next);
    if (originalExclusions.length !== excluded.length) this.write(EXCLUDED_KEY, excluded);
    if (orderedWordIds.length && !initialized) this.write(INIT_KEY, true);
    return { size, groups: next };
  }

  /** Remove from the plan only; never delete the source library word. */
  excludeWordFromDay(wordId: string, day: number): void {
    const groups = this.getGroups();
    if (!isValidDay(day) || !groups.some((g) => g.day === day && g.words.includes(wordId))) return;
    const excluded = new Set(this.getExcludedWordIds());
    excluded.add(wordId);
    // Save exclusion first, so a later sync cannot silently re-add a removed word.
    this.write(EXCLUDED_KEY, [...excluded]);
    this.removeFromGroups(groups, wordId, day);
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

    const excluded = this.getExcludedWordIds();
    this.saveGroups(this.sortGroupsByDay(groups));
    if (excluded.includes(wordId))
      this.write(
        EXCLUDED_KEY,
        excluded.filter((id) => id !== wordId),
      );
  }

  clearDay(day: number): number {
    if (!isValidDay(day)) return 0;
    const groups = this.getGroups();
    const removed = new Set(
      groups.filter((group) => group.day === day).flatMap((group) => group.words),
    );
    if (!removed.size) return 0;

    const remaining = groups.filter((group) => group.day !== day);
    const assignedElsewhere = new Set(remaining.flatMap((group) => group.words));
    const excludedFromPlan = [...removed].filter((id) => !assignedElsewhere.has(id));
    const previousExclusions = this.getExcludedWordIds();
    this.write(EXCLUDED_KEY, [...new Set([...previousExclusions, ...excludedFromPlan])]);
    try {
      this.saveGroups(remaining);
    } catch (error) {
      this.write(EXCLUDED_KEY, previousExclusions);
      throw error;
    }
    return removed.size;
  }

  /** Move/add several existing library words in one atomic group write. */
  assignManyToDay(
    wordIds: string[],
    day: number,
  ): { added: number; moved: number; already: number } {
    if (!isValidDay(day)) throw new Error("Gün 1–60 arasında olmalıdır.");
    const unique = [...new Set(wordIds)];
    if (unique.some((id) => typeof id !== "string" || !id.trim()))
      throw new Error("Geçersiz kelime seçimi.");
    const groups = this.getGroups();
    const target = groups.find((group) => group.day === day) ?? { day, words: [] };
    const already = unique.filter((id) => target.words.includes(id)).length;
    const pending = unique.filter((id) => !target.words.includes(id));
    if (target.words.length + pending.length > MAX_WORDS_PER_DAY)
      throw new Error(
        `Bu günde yalnızca ${Math.max(0, MAX_WORDS_PER_DAY - target.words.length)} boş yer var.`,
      );
    if (!pending.length) return { added: 0, moved: 0, already };

    let moved = 0;
    for (const id of pending) {
      const previous = groups.find((group) => group.day !== day && group.words.includes(id));
      if (previous) {
        previous.words = previous.words.filter((wordId) => wordId !== id);
        moved += 1;
      }
      target.words.push(id);
    }
    if (!groups.some((group) => group.day === day)) groups.push(target);
    const excluded = this.getExcludedWordIds();
    this.saveGroups(this.sortGroupsByDay(groups.filter((group) => group.words.length > 0)));
    const nextExcluded = excluded.filter((id) => !pending.includes(id));
    if (excluded.length !== nextExcluded.length) this.write(EXCLUDED_KEY, nextExcluded);
    return { added: pending.length - moved, moved, already };
  }

  // Geriye uyumlu: day verilmezse kelimenin bulunduğu gruptan çıkarılır.
  // day verilirse sadece belirtilen gün hedeflenir.
  removeWordFromDay(wordId: string, day?: number): void {
    if (typeof wordId !== "string" || !wordId.trim()) return;
    if (day !== undefined && !isValidDay(day)) return;

    this.removeFromGroups(this.getStoredGroups(), wordId, day);
  }

  private removeFromGroups(groups: DailyWordGroup[], wordId: string, day?: number) {
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
    const groups = this.getStoredGroups(true);
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
