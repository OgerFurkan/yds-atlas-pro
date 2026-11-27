import { BookOpen, History, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { withOccurrenceKeys } from "@/shared/lib/occurrence-keys";
import { Button } from "@/shared/ui/button";
import type { useChatConversation } from "../hooks/use-chat-conversation";
import { ChatHistoryPanel } from "./chat-history-panel";
import { ChatMessageMarkdown } from "./chat-message-markdown";

export function ChatTranscript({
  conversation,
  onLogin,
}: {
  conversation: ReturnType<typeof useChatConversation>;
  onLogin: () => void;
}) {
  const { t } = useTranslation();
  const {
    messages,
    busy,
    error,
    showHistory,
    history,
    setHistory,
    openHistoryConversation,
    send,
    retryCount,
    retryMessages,
    needsSignIn,
  } = conversation;
  const messageEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length || busy || error)
      messageEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, error]);
  const suggestions = t("chat.suggestions", { returnObjects: true }) as string[];
  const suggestionIcons = [BookOpen, Sparkles, History];

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {showHistory && (
        <ChatHistoryPanel
          history={history}
          setHistory={setHistory}
          onOpen={openHistoryConversation}
        />
      )}
      {!showHistory && !messages.length && !busy && (
        <div className="flex flex-col">
          <h2 className="text-center text-xl font-bold">{t("chat.greeting")}</h2>
          <p className="mt-2 text-center text-sm text-[#536b7d]">{t("chat.welcome")}</p>
          <div className="mt-1">
            {suggestions.map((suggestion, index) => {
              const Icon = suggestionIcons[index] ?? Sparkles;
              return (
                <button
                  type="button"
                  key={suggestion}
                  className="flex w-full items-center gap-4 border-b border-border px-3 py-3.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted"
                  onClick={() => void send(suggestion)}
                >
                  <Icon size={20} className="shrink-0 text-atlas-orange" />
                  {suggestion}
                </button>
              );
            })}
          </div>
          <img
            src="/brand/atlas-mascot.png"
            alt=""
            className="mx-auto mt-4 h-32 w-40 object-contain object-bottom"
          />
        </div>
      )}
      {!showHistory &&
        withOccurrenceKeys(messages, (message) =>
          JSON.stringify([message.role, message.content]),
        ).map(({ item: message, key }) => (
          <div
            key={key}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {message.role === "user" ? (
              <p className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl bg-[#123b59] px-3.5 py-2.5 text-sm leading-6 text-white">
                {message.content}
              </p>
            ) : (
              <div className="min-w-0 max-w-[93%] rounded-2xl border border-border bg-card px-4 py-3 text-foreground shadow-sm">
                <ChatMessageMarkdown content={message.content} />
              </div>
            )}
          </div>
        ))}
      {busy && (
        <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
          <LoaderCircle size={15} className="animate-spin" />
          {retryCount > 0 ? t("chat.retrying", { count: retryCount }) : t("chat.thinking")}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800" role="alert">
          <p className="text-xs leading-5">{error}</p>
          {retryMessages && !needsSignIn && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 border-red-300 bg-white text-red-800 hover:bg-red-100"
              disabled={busy}
              onClick={() => void send("", retryMessages)}
            >
              {t("chat.retrySameQuestion")}
            </Button>
          )}
        </div>
      )}
      {needsSignIn && (
        <div className="rounded-lg border border-orange-200 bg-atlas-orange/50 p-3 text-sm text-black">
          <p>{t("chat.loginRequired")}</p>
          <Button
            className="mt-2"
            size="sm"
            onClick={() => {
              onLogin();
            }}
          >
            {t("chat.signIn")}
          </Button>
        </div>
      )}
      <div ref={messageEnd} />
    </div>
  );
}
