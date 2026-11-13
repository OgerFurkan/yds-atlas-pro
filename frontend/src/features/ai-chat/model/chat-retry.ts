import type { AiChatRequest } from "@yds-atlas/shared";

/** Manual retry preserves displayed history but only replays the failed user question. */
export function lastFailedUserQuestion(
  conversation: AiChatRequest["messages"],
): AiChatRequest["messages"] {
  for (let index = conversation.length - 1; index >= 0; index--) {
    const message = conversation[index];
    if (message.role === "user" && message.content.trim()) return [message];
  }
  return [];
}
