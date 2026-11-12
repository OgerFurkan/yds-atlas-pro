import type { AiChatRequest } from "@yds-atlas/shared";
import {
  ArrowUp,
  BookOpen,
  ChevronDown,
  History,
  LoaderCircle,
  MessageCircleText,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { sendChat } from "../api/ai-chat-api";

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
    const conversation = previouslyFailed ?? [
      ...messages,
      { role: "user" as const, content: trimmed },
    ].slice(-12);
    const retryAttempt = previouslyFailed ? retryCount + 1 : 0;
    const requestMessages = previouslyFailed && conversation.length > 1
      ? conversation.slice(-1)
      : conversation;
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
        setError(retryAttempt > 0
          ? "Gemini yeniden denemede de zaman aşımına uğradı. İstek gönderiliyor fakat sunucudan yanıt gelmiyor; Render/Gemini servis günlükleri kontrol edilmeli."
          : t("chat.timeout"));
      else if (reason instanceof ApiError && reason.code === "AI_NETWORK_ERROR")
        setError(t("chat.networkError"));
      else if (reason instanceof ApiError && reason.code === "AI_AUTH_ERROR")
        setError(t("chat.providerAuth"));
      else if (reason instanceof ApiError && reason.code === "AI_MODEL_NOT_FOUND")
        setError(t("chat.modelUnavailable"));
      else if (reason instanceof ApiError && reason.code === "AI_REQUEST_REJECTED")
        setError(t("chat.requestRejected"));
      else if (reason instanceof ApiError && reason.code === "AI_UPSTREAM_ERROR")
        setError(t("chat.providerUnavailable"));
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

  const suggestions = t("chat.suggestions", { returnObjects: true }) as string[];
  const suggestionIcons = [BookOpen, Sparkles, History];

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
                <div className="space-y-2">
                  <h2 className="font-bold">{t("chat.history")}</h2>
                  {history.length ? (
                    history.map((conversation, index) => (
                      <button
                        type="button"
                        key={index}
                        className="block w-full truncate rounded-lg bg-[#ffffff] p-3 text-left text-sm"
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
                          setNeedsSignIn(false);
                          setError("");
                          setRetryMessages(null);
                        }}
                      >
                        {conversation[0]?.content}
                      </button>
                    ))
                  ) : (
                    <p className="text-sm">{t("chat.historyEmpty")}</p>
                  )}
                </div>
              ) : null}
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
                          className="flex w-full items-center gap-4 border-b border-[#dce6ec] px-2 py-4 text-left text-sm hover:bg-atlas-navy/70"
                          onClick={() => void send(suggestion)}
                        >
                          <Icon size={20} className="shrink-0 text-[#f27637]" />
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
                messages.map((message, index) => (
                  <div
                    key={`${index}-${message.role}`}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <p
                      className={`max-w-[88%] whitespace-pre-wrap rounded-xl px-3 py-2.5 text-sm leading-6 ${message.role === "user" ? "bg-[#123b59] text-white" : "bg-[#ffffff] text-[#123b59] shadow-sm"}`}
                    >
                      {message.content}
                    </p>
                  </div>
                ))}
              {busy && (
                <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
                  <LoaderCircle size={15} className="animate-spin" />
                  {retryCount > 0 ? `Yeniden deneniyor (${retryCount}. deneme)...` : t("chat.thinking")}
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
                      {retryCount > 0 ? "Tekrar dene (sunucu hâlâ yanıt vermiyor)" : "Aynı isteği tekrar dene"}
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
                      setOpen(false);
                      onLogin();
                    }}
                  >
                    {t("chat.signIn")}
                  </Button>
                </div>
              )}
              <div ref={messageEnd} />
            </div>
          </div>

          <form
            onSubmit={submit}
            className="shrink-0 rounded-3xl border border-[#dce6ec] bg-[#ffffff] p-3 shadow-[0_8px_30px_rgba(18,59,89,0.20)]"
          >
            <div className="flex items-end gap-2 bg">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                aria-label={t("chat.placeholder")}
                placeholder={t("chat.placeholder")}
                className="max-h-24 min-h-10 resize-none border-0 bg-transparent px-1 py-2 text-sm text-[#123b59] shadow-none placeholder:text-[#536b7d] focus-visible:ring-0"
                maxLength={1800}
                rows={1}
                disabled={busy || needsSignIn}
              />
              <Button
                type="submit"
                size="icon"
                className="size-9 shrink-0 rounded-md"
                aria-label={t("chat.send")}
                disabled={!draft.trim() || busy || needsSignIn}
              >
                <ArrowUp size={18} />
              </Button>
            </div>
          </form>
        </section>
      )}
      {!open && (
        <Button
          className="h-16 w-[min(350px,calc(100vw-32px))] justify-start gap-3 rounded-full border border-[#dce6ec] bg-[#ffffff] px-3 text-[#123b59] shadow-[0_8px_32px_rgba(18,59,89,0.22)] hover:bg-[#ffffff]"
          aria-expanded={false}
          aria-label={t("chat.launcher")}
          onClick={() => setOpen(true)}
        >
          <img
            src="/brand/atlas-mascot.png"
            alt=""
            className="size-11 rounded-full bg-[#e8f2f7] object-cover"
          />
          <span className="flex-1 text-left">{t("chat.placeholder")}</span>
          <span className="rounded-full bg-[#123b59] px-4 py-2 text-white">
            {<MessageCircleText />}
          </span>
        </Button>
      )}
    </div>
  );
}
