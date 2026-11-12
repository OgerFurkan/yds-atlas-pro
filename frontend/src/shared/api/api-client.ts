import { supabase } from "./supabase-client";
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;
  constructor(message: string, status: number, code = "REQUEST_FAILED", retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  expectedUserId?: string,
): Promise<T> {
  const session = await supabase?.auth.getSession();
  if (!session?.data.session || (expectedUserId && session.data.session.user.id !== expectedUserId))
    throw new ApiError("Devam etmek için hesabına giriş yap.", 401, "UNAUTHENTICATED");
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
    if (error instanceof Error && (error.name === "TimeoutError" ||
        (error.name === "AbortError" && !init?.signal?.aborted))) {
      throw new ApiError("İstek zaman aşımına uğradı.", 408, "AI_TIMEOUT");
    }
    throw new ApiError(
      "Sunucuya ulaşılamadı. Bağlantını kontrol edip yeniden dene.",
      0,
      "NETWORK_ERROR",
    );
  }
  const payload = await response.json().catch(() => null);
  const headerRetry = response.headers.get("Retry-After");
  const retrySeconds = headerRetry === null ? undefined : Number(headerRetry);
  const payloadRetry = payload?.retryAfterSeconds ?? payload?.retryInSeconds;
  const retryAfterSeconds = typeof payloadRetry === "number" && Number.isFinite(payloadRetry)
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
    );
  if (payload === null)
    throw new ApiError("Sunucudan geçersiz yanıt alındı.", 502, "INVALID_RESPONSE");
  return payload as T;
}
