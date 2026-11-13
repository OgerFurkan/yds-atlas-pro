import type { AiChatRequest } from "@yds-atlas/shared";
import { ChatMessageMarkdown } from "./chat-message-markdown";

interface ChatMessageListProps {
  messages: AiChatRequest["messages"];
}

/** User and assistant message bubbles; assistant content is rendered safely. */
export function ChatMessageList({ messages }: ChatMessageListProps) {
  return (
    <>
      {messages.map((message, index) => (
        <div
          key={`${index}-${message.role}`}
          className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
        >
          {message.role === "user" ? (
            <p className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl bg-[#123b59] px-3.5 py-2.5 text-sm leading-6 text-white">
              {message.content}
            </p>
          ) : (
            <div className="min-w-0 max-w-[93%] rounded-2xl border border-[#e5edf3] bg-white px-4 py-3 shadow-sm">
              <ChatMessageMarkdown content={message.content} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}
