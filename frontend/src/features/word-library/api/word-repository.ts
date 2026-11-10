import type { WordEntry, WordInput } from "@yds-atlas/shared";

type Result<T> = T | Promise<T>;
export interface WordRepository {
  list(): Result<WordEntry[]>;
  save(input: WordInput, id?: string): Result<WordEntry>;
  applyScores(updates: { id: string; score: number }[]): Result<void>;
  addMany(inputs: WordInput[]): Result<{ added: number; duplicates: number }>;
  removeMany(ids: string[]): Result<void>;
}
