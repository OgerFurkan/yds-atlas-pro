import type { AiChatRequest } from "@yds-atlas/shared";
import { ChevronDown, History, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";
import { sendChat } from "../api/ai-chat-api";
import { lastFailedUserQuestion } from "../model/chat-retry";
import { deleteHistoryConversation } from "../model/chat-history";
import { ChatMessageList } from "./chat-message-list";
import { ChatWelcome } from "./chat-welcome";
import { ChatComposer } from "./chat-composer";
import { ChatLauncher } from "./chat-launcher";
import { ChatErrorNotice } from "./chat-error-notice";
import { ChatSignInNotice } from "./chat-sign-in-notice";

export function AiChatWidget({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AiChatRequest["messages"]>([]);
  const [busy, setBusy] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [error, setError] = useState("");
  const [retryMessages, setRetryMessages] = useState<AiChatRequest["messages"] | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AiChatRequest["messages"][]>([]);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const messageEnd = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      const request = activeRequest.current;
      activeRequest.current = null;
      request?.abort();
    },
    [],
  );

  useEffect(() => {
    if (open) messageEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [open, messages, busy, error]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  async function send(content = draft, previouslyFailed?: AiChatRequest["messages"]) {
    const trimmed = content.trim();
    if ((!trimmed && !previouslyFailed) || busy) return;
    // Retrying an overloaded provider with the entire chat history may timeout again.
    // Keep the displayed history, but send only the last question after the first failure.
    const conversation =
      previouslyFailed ?? [...messages, { role: "user" as const, content: trimmed }].slice(-12);
    const retryAttempt = previouslyFailed ? retryCount + 1 : 0;
    // Never re-send an assistant reply accidentally on a manual retry. Keep the
    // history visible while replaying exactly the question that failed.
    const requestMessages = previouslyFailed ? lastFailedUserQuestion(conversation) : conversation;
    if (!requestMessages.length) return;
    if (!previouslyFailed) setRetryCount(0);
    else setRetryCount(retryAttempt);
    setMessages(conversation);
    if (!previouslyFailed) setDraft("");
    setError("");
    setRetryMessages(null);
    setNeedsSignIn(false);
    setShowHistory(false);
    setBusy(true);
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const response = await sendChat(requestMessages, controller.signal);
      if (activeRequest.current !== controller) return;
      setRetryCount(0);
      setMessages((current) =>
        [...current, { role: "assistant" as const, content: response.reply }].slice(-12),
      );
    } catch (reason) {
      if (activeRequest.current !== controller) return;
      if (reason instanceof ApiError && reason.code === "UNAUTHENTICATED") {
        setNeedsSignIn(true);
        return;
      }
      // Preserve the failed conversation and let the user retry it once manually.
      setRetryMessages(conversation);
      if (
        reason instanceof ApiError &&
        (reason.code === "NETWORK_ERROR" || reason.code === "INVALID_RESPONSE")
      )
        setError(t("chat.apiUnavailable"));
      else if (reason instanceof ApiError && reason.code === "AI_NOT_CONFIGURED")
        setError(t("chat.notConfigured"));
      else if (reason instanceof ApiError && reason.code === "AI_TIMEOUT")
        setError(t(retryAttempt > 0 ? "chat.timeoutAgain" : "chat.timeout"));
      else if (reason instanceof ApiError && reason.status === 429)
        setError(
          reason.retryAfterSeconds !== undefined
            ? t("chat.rateLimitedFor", { seconds: Math.ceil(reason.retryAfterSeconds) })
            : t("chat.rateLimited"),
        );
      else if (reason instanceof ApiError && reason.code === "AI_NETWORK_ERROR")
        setError(t("chat.networkError"));
      else if (reason instanceof ApiError && reason.code === "AI_AUTH_ERROR")
        setError(t("chat.providerAuth"));
      else if (reason instanceof ApiError && reason.code === "AI_MODEL_NOT_FOUND")
        setError(t("chat.modelUnavailable"));
      else if (reason instanceof ApiError && reason.code === "AI_REQUEST_REJECTED")
        setError(t("chat.requestRejected"));
      else if (
        reason instanceof ApiError &&
        (reason.code === "AI_UPSTREAM_ERROR" || reason.status === 503)
      )
        setError(t("chat.providerBusy"));
      else setError(reason instanceof Error ? reason.message : t("chat.error"));
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  function cancelRequest() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setBusy(false);
  }

  function newChat() {
    cancelRequest();
    if (messages.length) setHistory((previous) => [messages, ...previous].slice(0, 10));
    setMessages([]);
    setDraft("");
    setError("");
    setRetryMessages(null);
    setRetryCount(0);
    setNeedsSignIn(false);
    setMenuOpen(false);
    setShowHistory(false);
    setPendingDeleteIndex(null);
    setConfirmClearHistory(false);
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open && (
        <section
          className="atlas-chat-panel flex h-[min(590px,calc(100dvh-32px))] w-[min(390px,calc(100vw-32px))] flex-col gap-3"
          role="dialog"
          aria-label={t("chat.title")}
          aria-modal="false"
        >
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-[#f7f9fc] text-[#123b59] shadow-[0_12px_42px_rgba(9,38,59,0.22)]">
            <header className="relative z-10 flex shrink-0 items-center justify-between bg-[#dcecf4] px-5 py-3">
              <button
                type="button"
                className="flex items-center gap-2 rounded-full px-2 py-1 text-sm font-bold hover:bg-white/70"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                YDS Atlas <span className="rounded bg-[#f27637] px-1 text-xs text-white">AI</span>
                <ChevronDown size={16} />
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="text-[#123b59]"
                aria-label={t("chat.close")}
                onClick={() => setOpen(false)}
              >
                <X size={19} />
              </Button>
              {menuOpen && (
                <div className="absolute top-14 right-4 left-4 rounded-xl bg-[#ffffff] p-2 text-[#123b59] shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-[#eff5f8]"
                    onClick={newChat}
                  >
                    <Plus size={17} />
                    {t("chat.newChat")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-[#eff5f8]"
                    onClick={() => {
                      cancelRequest();
                      if (messages.length) {
                        setHistory((previous) => [messages, ...previous].slice(0, 10));
                        setMessages([]);
                      }
                      setError("");
                      setRetryMessages(null);
                      setNeedsSignIn(false);
                      setShowHistory(true);
                      setPendingDeleteIndex(null);
                      setConfirmClearHistory(false);
                      setMenuOpen(false);
                    }}
                  >
                    <History size={17} />
                    {t("chat.history")}
                  </button>
                </div>
              )}
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {showHistory ? (
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
                    <div
                      className="space-y-2 rounded-xl border border-[#efc5c0] bg-[#fff5f3] p-3 text-sm text-[#7c2620]"
                      role="group"
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
                    </div>
                  )}
                  {history.length ? (
                    history.map((conversation, index) => (
                      <div
                        key={index}
                        className="overflow-hidden rounded-xl border border-[#e3ecf2] bg-white shadow-sm"
                      >
                        <div className="flex min-w-0 items-center gap-1 p-1.5">
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-sm text-[#123b59] hover:bg-[#eff5f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#17649c]"
                            onClick={() => {
                              if (messages.length)
                                setHistory((previous) => [
                                  messages,
                                  ...previous.filter((_, itemIndex) => itemIndex !== index),
                                ]);
                              else
                                setHistory((previous) =>
                                  previous.filter((_, itemIndex) => itemIndex !== index),
                                );
                              setMessages(conversation);
                              setShowHistory(false);
                              setPendingDeleteIndex(null);
                              setConfirmClearHistory(false);
                              setNeedsSignIn(false);
                              setError("");
                              setRetryMessages(null);
                            }}
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
                              setPendingDeleteIndex((current) =>
                                current === index ? null : index,
                              );
                              setConfirmClearHistory(false);
                            }}
                          >
                            <Trash2 size={17} aria-hidden="true" />
                          </button>
                        </div>
                        {pendingDeleteIndex === index && (
                          <div
                            className="space-y-2 border-t border-[#efdedb] bg-[#fff8f7] px-3 py-3 text-xs text-[#7c2620]"
                            role="group"
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
                                  setHistory((previous) =>
                                    deleteHistoryConversation(previous, index),
                                  );
                                  setPendingDeleteIndex(null);
                                }}
                              >
                                {t("chat.confirmDelete")}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[#536b7d]">{t("chat.historyEmpty")}</p>
                  )}
                </div>
              ) : null}
              {!showHistory && !messages.length && !busy && (
                <ChatWelcome
                  onChoose={(suggestion) => {
                    void send(suggestion);
                  }}
                />
              )}
              {!showHistory && <ChatMessageList messages={messages} />}
              {busy && (
                <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
                  <LoaderCircle size={15} className="animate-spin" />
                  {retryCount > 0 ? t("chat.retrying", { count: retryCount }) : t("chat.thinking")}
                </div>
              )}
              {error && (
                <ChatErrorNotice
                  error={error}
                  busy={busy}
                  canRetry={Boolean(retryMessages) && !needsSignIn}
                  onRetry={() => {
                    if (retryMessages) void send("", retryMessages);
                  }}
                />
              )}
              {needsSignIn && (
                <ChatSignInNotice
                  onSignIn={() => {
                    setOpen(false);
                    onLogin();
                  }}
                />
              )}
              <div ref={messageEnd} />
            </div>
          </div>

          <ChatComposer
            draft={draft}
            busy={busy}
            needsSignIn={needsSignIn}
            onDraftChange={setDraft}
            onSubmit={submit}
            onKeyDown={handleKeyDown}
          />
        </section>
      )}
      {!open && <ChatLauncher onOpen={() => setOpen(true)} />}
    </div>
  );
}
