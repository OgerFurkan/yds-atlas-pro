import { useSyncExternalStore } from "react";
import { storageGeneration } from "./storage-scope";

export type AiIssueKind =
  | "quota"
  | "auth"
  | "model"
  | "request"
  | "network"
  | "timeout"
  | "unavailable"
  | "unknown";

export type AiIssue = {
  code: string;
  kind: AiIssueKind;
  message: string;
  at: number;
};

const MAX_ISSUES = 4;

function kindFor(code: string): AiIssueKind {
  if (code === "AI_QUOTA_EXCEEDED" || code === "QUOTA_EXCEEDED") return "quota";
  if (code === "AI_PERMISSION_DENIED" || code === "AI_AUTH_ERROR" || code === "UNAUTHENTICATED")
    return "auth";
  if (code === "AI_MODEL_NOT_FOUND") return "model";
  if (code === "AI_REQUEST_REJECTED" || code === "AI_INVALID_RESPONSE") return "request";
  if (code === "AI_NETWORK_ERROR" || code === "NETWORK_ERROR") return "network";
  if (code === "AI_TIMEOUT") return "timeout";
  if (code === "AI_UPSTREAM_ERROR") return "unavailable";
  return "unknown";
}

// Operation messages can include the learner's word. Keep them only within this session.
let generation = storageGeneration();
let issues: AiIssue[] = [];
function currentIssues() {
  if (storageGeneration() !== generation) {
    generation = storageGeneration();
    issues = [];
  }
  return issues;
}
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

// Only user-facing messages are kept. Provider bodies and credentials never reach this store.
export function recordAiIssue(error: unknown) {
  if (!error) return;
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : "UNKNOWN";
  const raw = error instanceof Error ? error.message.trim() : "";
  // Technical schema messages are noisy; keep the card readable.
  const message = raw && code !== "UNKNOWN" ? raw : "Beklenmeyen bir AI yanıtı alındı.";
  issues = [
    { code, kind: kindFor(code), message, at: Date.now() },
    ...currentIssues().filter((issue) => issue.code !== code),
  ].slice(0, MAX_ISSUES);
  publish();
}

export function clearAiIssues() {
  issues = [];
  publish();
}

export function subscribeAiIssues(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAiIssues() {
  return currentIssues();
}

export function useAiIssues() {
  return useSyncExternalStore(subscribeAiIssues, getAiIssues, getAiIssues);
}
