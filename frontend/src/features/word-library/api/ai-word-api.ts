import { aiWordRequestSchema, aiWordResponseSchema } from "@yds-atlas/shared";
import { apiRequest } from "@/shared/api/api-client";
export async function enrichWithGemini(word: string, signal?: AbortSignal) {
  const request = aiWordRequestSchema.parse({ word });
  return aiWordResponseSchema.parse(
    await apiRequest("/api/ai/words/enrich", {
      method: "POST",
      body: JSON.stringify(request),
      signal,
    }),
  );
}
