import { wordEntrySchema, type WordEntry, type WordInput } from "@yds-atlas/shared";
import { apiRequest } from "@/shared/api/api-client";
import { enrichWordInput } from "../data/starter-vocabulary";
import type { WordRepository } from "./word-repository";
export function remoteWordRepository(userId: string): WordRepository {
  const call = <T>(path: string, init?: RequestInit) => apiRequest<T>(path, init, userId);
  return {
    async list() {
      return wordEntrySchema.array().parse(await call<WordEntry[]>("/api/words"));
    },
    async save(input, id) {
      return wordEntrySchema.parse(
        await call("/api/words" + (id ? "/" + id : ""), {
          method: id ? "PUT" : "POST",
          body: JSON.stringify(enrichWordInput(input)),
        }),
      );
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
    async applyScores(updates) {
      await call("/api/words/scores", { method: "PUT", body: JSON.stringify(updates) });
    },
  };
}
