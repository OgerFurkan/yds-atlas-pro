import { wordGroupSchema, type WordEntry, type WordGroup } from "@yds-atlas/shared";

/** Atomic local mapping. Legacy score and learning-results evidence are unchanged. */
export function applyManualGroupUpdates(
  words: readonly WordEntry[],
  updates: readonly { id: string; group: WordGroup }[],
  at: string = new Date().toISOString(),
): WordEntry[] {
  if (!updates.length || updates.length > 500) throw new Error("Geçersiz kelime grubu isteği.");
  const ids = new Set(words.map((word) => word.id));
  const assigned = new Map<string, WordGroup>();
  for (const { id, group } of updates) {
    if (!id?.trim() || !ids.has(id) || assigned.has(id) || !wordGroupSchema.safeParse(group).success)
      throw new Error("Kelime grubu değişikliği geçersiz; hiçbir kelime değiştirilmedi.");
    assigned.set(id, group);
  }
  return words.map((word) => {
    const group = assigned.get(word.id);
    return group === undefined ? word : { ...word, manualGroup: group, updatedAt: at };
  });
}
