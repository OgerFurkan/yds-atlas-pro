import { type WordEntry, wordEntrySchema } from "@yds-atlas/shared";
import { readSession } from "@/features/learning-game/task-storage";
import { readStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { getStorageScope, localFixtureProfile, scopedStorageKey } from "@/shared/lib/storage-scope";
import { DAILY_PLAN_DAYS } from "../model/daily-groups";
import { wordKey } from "../model/word-normalization";
import { DailyWordGroupsRepository } from "./daily-word-groups-repository";
import { localWordRepository, withLocalWordWrite } from "./local-word-repository";

export type FixtureVariant = "ready" | "partial";

export async function updateFixtureLibrary(load: boolean, variant: FixtureVariant = "ready") {
  if (!localFixtureProfile || getStorageScope() !== null)
    throw new Error("Sentetik veri yalnız yerel test profilinde kullanılabilir.");
  const response = await fetch(
    variant === "partial" ? "/__atlas_local_fixtures?variant=partial" : "/__atlas_local_fixtures",
  );
  if (!response.ok) throw new Error("Yerel sentetik veri okunamadı.");
  const fixture = wordEntrySchema
    .array()
    .array()
    .parse(await response.json());
  if (fixture.length !== 2 || fixture[0].length !== 20 || fixture[1].length !== 4)
    throw new Error("Yerel sentetik veri eksik.");
  if (getStorageScope() !== null) throw new Error("Yerel test profili değişti.");
  return withLocalWordWrite(() => writeFixtureLibrary(fixture, load));
}

function writeFixtureLibrary(fixture: WordEntry[][], load: boolean) {
  const entries = localWordRepository.list();
  const demoIds = new Set(fixture.flat().map((word) => word.id));
  const otherEntries = entries.filter((word) => !demoIds.has(word.id));
  const currentGroups = new DailyWordGroupsRepository().getGroups();
  const groups = currentGroups
    .map(({ day, words }) => ({ day, words: words.filter((id) => !demoIds.has(id)) }))
    .filter((group) => group.words.length > 0);
  const days: number[] = [];
  if (load) {
    const currentEntries = new Map(entries.map((word) => [word.id, word]));
    const demoEntries = fixture.flat().map((word) => {
      const current = currentEntries.get(word.id);
      // The selected variant decides the synthetic scores; other edits survive a reload.
      return current && current.score !== word.score
        ? {
            ...current,
            score: word.score,
            updatedAt: new Date(
              Math.max(Date.now(), Date.parse(current.updatedAt) + 1),
            ).toISOString(),
          }
        : (current ?? word);
    });
    const names = new Set(otherEntries.map((word) => wordKey(word.word)));
    for (const word of demoEntries) {
      const name = wordKey(word.word);
      if (names.has(name))
        throw new Error(`“${word.word}” zaten bu test profilinde var. Mevcut kayıtlar korundu.`);
      names.add(name);
    }
    for (const deck of fixture) {
      const ids = deck.map((word) => word.id);
      const occupied = new Set(groups.map((group) => group.day));
      const previous = currentGroups.find(
        (group) => !occupied.has(group.day) && group.words.some((id) => ids.includes(id)),
      );
      const day =
        previous?.day ??
        Array.from({ length: DAILY_PLAN_DAYS }, (_, index) => index + 1).find(
          (index) => !occupied.has(index),
        );
      if (day === undefined) throw new Error("Sentetik gruplar için iki boş gün gerekiyor.");
      groups.push({ day, words: ids });
      days.push(day);
    }
    otherEntries.push(...demoEntries);
  }

  const changes = new Map<string, string | null>([
    [storageKeys.words, JSON.stringify(otherEntries)],
    [storageKeys.dailyWordGroups, JSON.stringify(groups.sort((a, b) => a.day - b.day))],
  ]);
  const exclusions = new DailyWordGroupsRepository().getExcludedWordIds();
  if (exclusions.some((id) => demoIds.has(id)))
    changes.set(
      storageKeys.dailyWordExclusions,
      JSON.stringify(exclusions.filter((id) => !demoIds.has(id))),
    );
  if (!load) {
    const session = readSession();
    if (session?.words.every((word) => demoIds.has(word.id)))
      changes.set(storageKeys.gameSession, null);
    const progress = readStorage<Record<string, string[]>>(storageKeys.dailyProgress, {});
    const completed = readStorage<Record<string, boolean>>(storageKeys.completedDays, {});
    const targets = readStorage<Record<string, number>>(storageKeys.goalPerDay, {});
    for (const [day, ids] of Object.entries(progress)) {
      if (!ids.some((id) => demoIds.has(id))) continue;
      const remaining = ids.filter((id) => !demoIds.has(id));
      if (remaining.length) progress[day] = remaining;
      else delete progress[day];
      if (remaining.length < (targets[day] ?? 20)) delete completed[day];
      changes.set(storageKeys.dailyProgress, JSON.stringify(progress));
      changes.set(storageKeys.completedDays, JSON.stringify(completed));
    }
  }
  const written = new Map<string, string | null>();
  try {
    for (const [key, next] of changes) {
      const scoped = scopedStorageKey(key);
      const previous = localStorage.getItem(scoped);
      if (previous === next) continue;
      if (next === null) localStorage.removeItem(scoped);
      else localStorage.setItem(scoped, next);
      written.set(scoped, previous);
    }
  } catch (error) {
    for (const [key, previous] of written) {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    }
    throw error;
  }
  return days;
}
