import { type AiChatRequest, aiChatRequestSchema, aiChatResponseSchema } from "@yds-atlas/shared";
import { apiRequest } from "@/shared/api/api-client";

export async function sendChat(messages: AiChatRequest["messages"], signal?: AbortSignal) {
  const request = aiChatRequestSchema.parse({ messages });
  return aiChatResponseSchema.parse(
    await apiRequest("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify(request),
      signal,
    }),
  );
}
