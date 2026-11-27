export interface DailyWordGroup {
  day: number;
  words: string[];
}

export function allocateDailyGroups(
  orderedWordIds: string[],
  original: DailyWordGroup[],
  originalExclusions: string[],
  requestedSize: number,
  preserveMissing: boolean,
  maxDay: number,
  maxWordsPerDay: number,
) {
  const validIds = new Set(orderedWordIds);
  if (validIds.size !== orderedWordIds.length || orderedWordIds.some((id) => !id.trim()))
    throw new Error("Kelime listesi doğrulanamadı. Günlük plan korundu.");
  const excluded = preserveMissing
    ? originalExclusions
    : originalExclusions.filter((id) => validIds.has(id));
  const exclusions = new Set(excluded);
  const storedIds = original.flatMap((group) => group.words);
  if (
    new Set(storedIds).size !== storedIds.length ||
    new Set(original.map((group) => group.day)).size !== original.length
  )
    throw new Error("Günlük planda çakışan atamalar var. Özgün kayıt korundu.");
  const normalized = original.map((group) => ({
    ...group,
    words: group.words.filter((id) => (preserveMissing || validIds.has(id)) && !exclusions.has(id)),
  }));
  const assigned = new Set(normalized.flatMap((group) => group.words));

  const size = Number.isFinite(requestedSize)
    ? Math.min(maxWordsPerDay, Math.max(10, Math.round(requestedSize)))
    : 20;
  for (const id of orderedWordIds) {
    if (assigned.has(id) || exclusions.has(id)) continue;
    for (let day = 1; day <= maxDay; day += 1) {
      let group = normalized.find((item) => item.day === day);
      if (group && group.words.length >= size) continue;
      if (!group) {
        group = { day, words: [] };
        normalized.push(group);
      }
      group.words.push(id);
      assigned.add(id);
      break;
    }
  }

  const next = normalized.filter((group) => group.words.length > 0).sort((a, b) => a.day - b.day);
  return { size, next, excluded };
}
