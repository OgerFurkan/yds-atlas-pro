import type { AiChatRequest } from "@yds-atlas/shared";
import { Trash2 } from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { useTranslation } from "react-i18next";
import { withOccurrenceKeys } from "@/shared/lib/occurrence-keys";
import { deleteHistoryConversation } from "../model/chat-history";

type Conversation = AiChatRequest["messages"];

export function ChatHistoryPanel({
  history,
  setHistory,
  onOpen,
}: {
  history: Conversation[];
  setHistory: Dispatch<SetStateAction<Conversation[]>>;
  onOpen: (conversation: Conversation, index: number) => void;
}) {
  const { t } = useTranslation();
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">{t("chat.history")}</h2>
        {history.length > 0 && (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-[#a3332c] hover:bg-[#fff0ee] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a3332c]"
            onClick={() => {
              setConfirmClearHistory((current) => !current);
              setPendingDeleteIndex(null);
            }}
          >
            <Trash2 size={15} aria-hidden="true" />
            {t("chat.clearHistory")}
          </button>
        )}
      </div>
      {confirmClearHistory && history.length > 0 && (
        <fieldset
          className="min-w-0 space-y-2 rounded-xl border border-[#efc5c0] bg-[#fff5f3] p-3 text-sm text-[#7c2620]"
          aria-label={t("chat.clearHistory")}
        >
          <p>{t("chat.clearHistoryConfirm")}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-[#ead3d0] bg-white px-3 py-1.5 text-xs font-medium"
              onClick={() => setConfirmClearHistory(false)}
            >
              {t("chat.cancelDelete")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-[#a3332c] px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => {
                setHistory([]);
                setConfirmClearHistory(false);
                setPendingDeleteIndex(null);
              }}
            >
              {t("chat.confirmDelete")}
            </button>
          </div>
        </fieldset>
      )}
      {history.length ? (
        withOccurrenceKeys(history, (conversation) => JSON.stringify(conversation)).map(
          ({ item: conversation, key }, index) => (
            <div
              key={key}
              className="overflow-hidden rounded-xl border border-[#e3ecf2] bg-white shadow-sm"
            >
              <div className="flex min-w-0 items-center gap-1 p-1.5">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-sm text-[#123b59] hover:bg-[#eff5f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#17649c]"
                  onClick={() => onOpen(conversation, index)}
                >
                  {conversation.find((message) => message.role === "user")?.content ??
                    conversation[0]?.content}
                </button>
                <button
                  type="button"
                  aria-label={t("chat.deleteConversationNamed", {
                    title:
                      conversation.find((message) => message.role === "user")?.content ??
                      t("chat.history"),
                  })}
                  title={t("chat.deleteConversation")}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[#8b4a47] hover:bg-[#fff0ee] hover:text-[#a3332c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a3332c]"
                  onClick={() => {
                    setPendingDeleteIndex((current) => (current === index ? null : index));
                    setConfirmClearHistory(false);
                  }}
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
              {pendingDeleteIndex === index && (
                <fieldset
                  className="min-w-0 space-y-2 border-t border-[#efdedb] bg-[#fff8f7] px-3 py-3 text-xs text-[#7c2620]"
                  aria-label={t("chat.deleteConversation")}
                >
                  <p>{t("chat.deleteConversationConfirm")}</p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[#ead3d0] bg-white px-3 py-1.5 font-medium"
                      onClick={() => setPendingDeleteIndex(null)}
                    >
                      {t("chat.cancelDelete")}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-[#a3332c] px-3 py-1.5 font-semibold text-white"
                      onClick={() => {
                        setHistory((previous) => deleteHistoryConversation(previous, index));
                        setPendingDeleteIndex(null);
                      }}
                    >
                      {t("chat.confirmDelete")}
                    </button>
                  </div>
                </fieldset>
              )}
            </div>
          ),
        )
      ) : (
        <p className="text-sm text-[#536b7d]">{t("chat.historyEmpty")}</p>
      )}
    </div>
  );
}
