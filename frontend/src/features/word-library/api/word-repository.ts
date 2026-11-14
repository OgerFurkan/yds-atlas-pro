import type { WordEntry, WordGroup, WordInput } from "@yds-atlas/shared";

type Result<T> = T | Promise<T>;
export interface WordRepository {
  list(): Result<WordEntry[]>;
  save(input: WordInput, id?: string): Result<WordEntry>;
  applyScores(updates: { id: string; score: number }[]): Result<void>;
  /** Explicit user categorization only. Must never modify score or learning results. */
  setGroups(updates: { id: string; group: WordGroup }[]): Result<void>;
  addMany(inputs: WordInput[]): Result<{ added: number; duplicates: number }>;
  removeMany(ids: string[]): Result<void>;
}
