import type { AiChatRequest } from "@yds-atlas/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/shared/api/api-client";
import { sendChat } from "../api/ai-chat-api";
import { chatError } from "../model/chat-error";
import { lastFailedUserQuestion } from "../model/chat-retry";

export function useChatConversation(
  owner: string | null,
  assessmentActive: boolean,
  setOpen: (open: boolean) => void,
) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AiChatRequest["messages"]>([]);
  const [busy, setBusy] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [error, setError] = useState("");
  const [retryMessages, setRetryMessages] = useState<AiChatRequest["messages"] | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AiChatRequest["messages"][]>([]);
  const activeRequest = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    if (assessmentActive) {
      activeRequest.current?.abort();
      activeRequest.current = null;
      // Let cancellation settle, and keep the launcher hidden immediately via assessmentActive.
      let current = true;
      queueMicrotask(() => {
        if (current) {
          setBusy(false);
          setOpen(false);
        }
      });
      return () => {
        current = false;
      };
    }
  }, [assessmentActive, setOpen]);

  useEffect(
    () => () => {
      const request = activeRequest.current;
      activeRequest.current = null;
      request?.abort();
    },
    [],
  );

  async function send(content = draft, previouslyFailed?: AiChatRequest["messages"]) {
    const trimmed = content.trim();
    if (assessmentActive || (!trimmed && !previouslyFailed) || activeRequest.current) return;
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
      const response = await sendChat(requestMessages, owner, controller.signal);
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
      setError(chatError(reason, retryAttempt, t));
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setBusy(false);
      }
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
    setShowHistory(false);
  }

  function openHistoryConversation(conversation: AiChatRequest["messages"], index: number) {
    if (messages.length)
      setHistory((previous) => [
        messages,
        ...previous.filter((_, itemIndex) => itemIndex !== index),
      ]);
    else setHistory((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
    setMessages(conversation);
    setShowHistory(false);
    setNeedsSignIn(false);
    setError("");
    setRetryMessages(null);
  }

  function viewHistory() {
    cancelRequest();
    if (messages.length) {
      setHistory((previous) => [messages, ...previous].slice(0, 10));
      setMessages([]);
    }
    setError("");
    setRetryMessages(null);
    setNeedsSignIn(false);
    setShowHistory(true);
  }
  return {
    draft,
    setDraft,
    messages,
    busy,
    needsSignIn,
    error,
    retryMessages,
    retryCount,
    showHistory,
    history,
    setHistory,
    send,
    newChat,
    openHistoryConversation,
    viewHistory,
  };
}
