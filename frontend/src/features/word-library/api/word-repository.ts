import type { WordEdit, WordEntry, WordInput } from "@yds-atlas/shared";

export class WordEditConflict extends Error {
  constructor() {
    super(
      "Bu kelime başka bir sekmede veya oturumda değişti. Düzenlemen bu formda duruyor. Kaydetmeden önce güncel kaydı açıp değişikliklerini yeniden uygula.",
    );
  }
}

export class WordEditLockUnavailable extends Error {
  constructor() {
    super(
      "Bu tarayıcıda sekmeler arası kayıt koruması kullanılamıyor. Değişiklikler kaydedilmedi. Taslağın bu formda duruyor. Metni kopyalayıp güncel bir tarayıcıda yeniden deneyebilirsin.",
    );
  }
}

type Result<T> = T | Promise<T>;
export interface WordRepository {
  list(): Result<WordEntry[]>;
  save(
    input: WordInput,
    id?: string,
    expectedUpdatedAt?: string,
    signal?: AbortSignal,
  ): Result<WordEntry>;
  edit(patch: WordEdit, id: string, expectedUpdatedAt: string): Result<WordEntry>;
  addMany(inputs: WordInput[]): Result<{ added: number; duplicates: number }>;
  removeMany(ids: string[]): Result<void>;
}
