import type { TFunction } from "i18next";
import { ApiError } from "@/shared/api/api-client";

export function chatError(reason: unknown, retryAttempt: number, t: TFunction) {
  if (
    reason instanceof ApiError &&
    (reason.code === "NETWORK_ERROR" || reason.code === "INVALID_RESPONSE")
  )
    return t("chat.apiUnavailable");
  else if (reason instanceof ApiError && reason.code === "AI_NOT_CONFIGURED")
    return t("chat.notConfigured");
  else if (reason instanceof ApiError && reason.code === "AI_TIMEOUT")
    return t(retryAttempt > 0 ? "chat.timeoutAgain" : "chat.timeout");
  else if (
    reason instanceof ApiError &&
    ["AI_BUSY", "AI_USAGE_UNAVAILABLE", "AI_PERMISSION_DENIED"].includes(reason.code)
  )
    return reason.message;
  else if (reason instanceof ApiError && reason.status === 429)
    return reason.retryAfterSeconds !== undefined
      ? t("chat.rateLimitedFor", { seconds: Math.ceil(reason.retryAfterSeconds) })
      : t("chat.rateLimited");
  else if (reason instanceof ApiError && reason.code === "AI_NETWORK_ERROR")
    return t("chat.networkError");
  else if (reason instanceof ApiError && reason.code === "AI_AUTH_ERROR")
    return t("chat.providerAuth");
  else if (reason instanceof ApiError && reason.code === "AI_MODEL_NOT_FOUND")
    return t("chat.modelUnavailable");
  else if (reason instanceof ApiError && reason.code === "AI_REQUEST_REJECTED")
    return t("chat.requestRejected");
  else if (
    reason instanceof ApiError &&
    (reason.code === "AI_UPSTREAM_ERROR" || reason.status === 503)
  )
    return t("chat.providerBusy");
  else return reason instanceof Error ? reason.message : t("chat.error");
}
