import type { AiChatRequest } from "@yds-atlas/shared";
import { ArrowUp, LoaderCircle, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/shared/api/api-client";
import { AtlasLogo } from "@/shared/brand/atlas-logo";
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
  const messageEnd = useRef<HTMLDivElement>(null);

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

  async function send(content = draft) {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    const userMessage = { role: "user" as const, content: trimmed };
    const history = [...messages, userMessage].slice(-12);
    setMessages(history);
    setDraft("");
    setError("");
    setNeedsSignIn(false);
    setBusy(true);
    try {
      const response = await sendChat(history);
      setMessages((current) =>
        [...current, { role: "assistant" as const, content: response.reply }].slice(-12),
      );
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "UNAUTHENTICATED") setNeedsSignIn(true);
      else if (
        reason instanceof ApiError &&
        (reason.code === "NETWORK_ERROR" || reason.code === "INVALID_RESPONSE")
      )
        setError(t("chat.apiUnavailable"));
      else if (reason instanceof ApiError && reason.code === "AI_NOT_CONFIGURED")
        setError(t("chat.notConfigured"));
      else if (reason instanceof ApiError && reason.code === "AI_TIMEOUT")
        setError(t("chat.timeout"));
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
      setBusy(false);
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

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open && (
        <section
          className="atlas-chat-panel flex h-[min(620px,calc(100dvh-112px))] w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_20px_70px_rgba(7,28,45,0.28)]"
          role="dialog"
          aria-label={t("chat.title")}
          aria-modal="false"
        >
          <header className="flex shrink-0 items-center gap-3 bg-[#123b59] px-4 py-3 text-white">
            <AtlasLogo className="size-10 rounded-full border border-white/40 bg-white p-1 shadow-sm" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-bold">{t("chat.title")}</h2>
              <p className="text-[11px] text-blue-100">{t("chat.subtitle")}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/15 hover:text-white"
              aria-label={t("chat.close")}
              onClick={() => setOpen(false)}
            >
              <X size={19} />
            </Button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-4">
            <div className="max-w-[88%] rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-700 shadow-sm">
              {t("chat.welcome")}
            </div>
            {!messages.length && !busy && (
              <div className="flex flex-wrap gap-2 pt-1">
                {suggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    disabled={busy}
                    className="rounded-full border border-atlas-blue/30 bg-white px-3 py-1.5 text-left text-xs text-atlas-navy transition-colors hover:border-atlas-orange hover:bg-orange-50"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={`${index}-${message.role}`}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <p
                  className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-3 py-2.5 text-sm leading-6 ${message.role === "user" ? "bg-[#123b59] text-white" : "border border-slate-200 bg-white text-slate-700 shadow-sm"}`}
                >
                  {message.content}
                </p>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
                <LoaderCircle size={15} className="animate-spin" /> {t("chat.thinking")}
              </div>
            )}
            {error && (
              <p className="text-xs leading-5 text-red-700" role="alert">
                {error}
              </p>
            )}
            {needsSignIn && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
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

          <form onSubmit={submit} className="shrink-0 border-t border-slate-200 bg-white p-3">
            <div className="flex items-end gap-2 rounded-lg border border-slate-200 bg-white p-2 focus-within:border-atlas-blue/60 focus-within:ring-2 focus-within:ring-atlas-blue/15">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                aria-label={t("chat.placeholder")}
                placeholder={t("chat.placeholder")}
                className="max-h-24 min-h-10 resize-none border-0 bg-transparent px-1 py-2 text-sm shadow-none focus-visible:ring-0"
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
            <p className="mt-1.5 text-center text-[10px] text-slate-400">{t("chat.footer")}</p>
          </form>
        </section>
      )}
      {!open && (
        <Button
          className="h-12 gap-2 rounded-full bg-[#123b59] px-4 text-white shadow-lg hover:bg-[#0c2e46]"
          aria-expanded={false}
          aria-label={t("chat.launcher")}
          onClick={() => setOpen(true)}
        >
          <AtlasLogo className="size-8 rounded-full border border-white/50 bg-white p-1" />
          <span>{t("chat.launcher")}</span>
        </Button>
      )}
    </div>
  );
}
