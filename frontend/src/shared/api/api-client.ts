import { type AiWordFailure, aiWordFailuresSchema } from "@yds-atlas/shared";
import { getStorageScope, storageGeneration } from "../lib/storage-scope";
import { supabase } from "./supabase-client";
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;
  readonly wordFailures?: AiWordFailure[];
  constructor(
    message: string,
    status: number,
    code = "REQUEST_FAILED",
    retryAfterSeconds?: number,
    wordFailures?: AiWordFailure[],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.wordFailures = wordFailures;
  }
}
export function accountRequest(owner: string) {
  const generation = storageGeneration();
  return <T>(path: string, init?: RequestInit) => apiRequest<T>(path, init, owner, generation);
}
export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  expectedUserId: string | null = getStorageScope(),
  generation = storageGeneration(),
): Promise<T> {
  init?.signal?.throwIfAborted();
  function verifyOwner() {
    if (
      generation !== storageGeneration() ||
      (expectedUserId && getStorageScope() !== expectedUserId)
    )
      throw new ApiError("Oturum değişti. İşlemi yeniden başlat.", 409, "SESSION_CHANGED");
  }
  verifyOwner();
  const session = await supabase?.auth.getSession();
  init?.signal?.throwIfAborted();
  verifyOwner();
  if (!session?.data.session || !expectedUserId)
    throw new ApiError("Devam etmek için hesabına giriş yap.", 401, "UNAUTHENTICATED");
  if (session.data.session.user.id !== expectedUserId)
    throw new ApiError("Oturum değişti. İşlemi yeniden başlat.", 409, "SESSION_CHANGED");
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", "Bearer " + session.data.session.access_token);
  const base = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
  const timeoutMs = path.startsWith("/api/ai/") ? 65_000 : 40_000;
  let response: Response;
  try {
    response = await fetch(base + path, {
      ...init,
      headers,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    init?.signal?.throwIfAborted();
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || (error.name === "AbortError" && !init?.signal?.aborted))
    ) {
      throw new ApiError("İstek zaman aşımına uğradı.", 408, "AI_TIMEOUT");
    }
    throw new ApiError(
      "Sunucuya ulaşılamadı. Bağlantını kontrol edip yeniden dene.",
      0,
      "NETWORK_ERROR",
    );
  }
  const payload = await response.json().catch(() => null);
  init?.signal?.throwIfAborted();
  verifyOwner();
  const headerRetry = response.headers.get("Retry-After");
  const retrySeconds = headerRetry === null ? undefined : Number(headerRetry);
  const payloadRetry = payload?.retryAfterSeconds ?? payload?.retryInSeconds;
  const retryAfterSeconds =
    typeof payloadRetry === "number" && Number.isFinite(payloadRetry)
      ? Math.max(0, payloadRetry)
      : retrySeconds !== undefined && Number.isFinite(retrySeconds)
        ? Math.max(0, retrySeconds)
        : undefined;
  if (!response.ok)
    throw new ApiError(
      payload?.error ?? "API sunucusundan geçerli yanıt alınamadı.",
      response.status,
      payload?.code ?? (payload === null ? "INVALID_RESPONSE" : "REQUEST_FAILED"),
      retryAfterSeconds,
      aiWordFailuresSchema.safeParse(payload?.failures).data,
    );
  if (payload === null)
    throw new ApiError("Sunucudan geçersiz yanıt alındı.", 502, "INVALID_RESPONSE");
  return payload as T;
}
