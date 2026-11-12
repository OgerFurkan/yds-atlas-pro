import { type AiChatRequest, aiChatRequestSchema, aiChatResponseSchema } from "@yds-atlas/shared";
import { apiRequest } from "@/shared/api/api-client";
import { recordAiIssue } from "@/shared/lib/ai-issues";

export async function sendChat(messages: AiChatRequest["messages"], signal?: AbortSignal) {
  const request = aiChatRequestSchema.parse({ messages });
  try {
    return aiChatResponseSchema.parse(
      await apiRequest("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify(request),
        signal,
      }),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    recordAiIssue(error);
    throw error;
  }
}
