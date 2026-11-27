import {
  type WordCursor,
  type WordEntry,
  type WordInput,
  wordCursorSchema,
  wordEntrySchema,
} from "@yds-atlas/shared";
import { enrichWordInput } from "@yds-atlas/shared/starter-vocabulary";
import { ApiError, accountRequest } from "@/shared/api/api-client";
import { WordEditConflict, type WordRepository } from "./word-repository";
export function remoteWordRepository(userId: string): WordRepository {
  const call = accountRequest(userId);
  return {
    async list() {
      try {
        return wordEntrySchema.array().parse(await call<WordEntry[]>("/api/words"));
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "WORD_LIST_LIMIT") throw e;
      }
      // Larger accounts use bounded transport and only publish a complete revision.
      for (let attempt = 0; attempt < 2; attempt++) {
        const result: WordEntry[] = [];
        const ids = new Set<string>();
        let cursor: WordCursor | null = null;
        let total = 0;
        try {
          do {
            const page = await call<{
              owner: string;
              revision: string;
              total: number | null;
              words: unknown;
              cursor: unknown;
            }>("/api/words/page", { method: "POST", body: JSON.stringify({ cursor }) });
            const next = wordCursorSchema.nullable().parse(page.cursor);
            if (
              page.owner !== userId ||
              (cursor
                ? page.total !== null || cursor.revision !== page.revision
                : typeof page.total !== "number" ||
                  !Number.isSafeInteger(page.total) ||
                  page.total < 0) ||
              (next && (next.owner !== userId || next.revision !== page.revision))
            )
              throw new Error("Kütüphane sürümü doğrulanamadı.");
            if (!cursor && typeof page.total === "number") total = page.total;
            const batch = wordEntrySchema.array().max(128).parse(page.words);
            for (const word of batch) {
              if (ids.has(word.id)) throw new Error("Kütüphanede yinelenen kimlik.");
              ids.add(word.id);
              result.push(word);
            }
            if ((batch.length && next?.id !== batch.at(-1)?.id) || result.length > total)
              throw new Error("Sayfa sonu doğrulanamadı.");
            if (result.length === total) return result;
            if (!next || !batch.length) throw new Error("Kütüphane eksik geldi.");
            cursor = next;
          } while (cursor);
        } catch (e) {
          if (attempt || !(e instanceof ApiError) || e.code !== "WORD_LIST_CHANGED") throw e;
        }
      }
      throw new Error("Kütüphane değişti. Yeniden dene.");
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
  };
}
