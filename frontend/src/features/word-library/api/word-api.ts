import { type WordEntry, type WordInput, wordEntrySchema } from "@yds-atlas/shared";
import { ApiError, apiRequest } from "@/shared/api/api-client";
import { enrichWordInput } from "../data/starter-vocabulary";
import { WordEditConflict, type WordRepository } from "./word-repository";
export function remoteWordRepository(userId: string): WordRepository {
  const call = <T>(path: string, init?: RequestInit) => apiRequest<T>(path, init, userId);
  return {
    async list() {
      return wordEntrySchema.array().parse(await call<WordEntry[]>("/api/words"));
    },
    async save(input, id, expectedUpdatedAt, signal) {
      return wordEntrySchema.parse(
        await call("/api/words" + (id ? "/" + id : ""), {
          method: id ? "PUT" : "POST",
          headers: expectedUpdatedAt
            ? { "X-Atlas-Expected-Updated-At": expectedUpdatedAt }
            : undefined,
          body: JSON.stringify(enrichWordInput(input)),
          signal,
        }),
      );
    },
    async edit(patch, id, expectedUpdatedAt) {
      try {
        return wordEntrySchema.parse(
          await call("/api/words/" + id, {
            method: "PATCH",
            headers: { "X-Atlas-Expected-Updated-At": expectedUpdatedAt },
            body: JSON.stringify(patch),
          }),
        );
      } catch (error) {
        if (error instanceof ApiError && error.code === "WORD_VERSION_CONFLICT")
          throw new WordEditConflict();
        throw error;
      }
    },
    async addMany(inputs: WordInput[]) {
      return call<{ added: number; duplicates: number }>("/api/words/import", {
        method: "POST",
        body: JSON.stringify(inputs.map(enrichWordInput)),
      });
    },
    async removeMany(ids) {
      await call("/api/words/bulk", { method: "DELETE", body: JSON.stringify(ids) });
    },
    async applyScores() {
      throw new Error("Hesap puanları yalnızca tamamlanan değerlendirmeden kaydedilir.");
    },
  };
}
