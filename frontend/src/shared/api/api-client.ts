import { supabase } from "./supabase-client";
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code = "REQUEST_FAILED") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
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
  let response: Response;
  try {
    response = await fetch(base + path, {
      ...init,
      headers,
      signal: init?.signal ?? AbortSignal.timeout(40_000),
    });
  } catch {
    throw new ApiError(
      "Sunucuya ulaşılamadı. Bağlantını kontrol edip yeniden dene.",
      0,
      "NETWORK_ERROR",
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      payload?.error ?? "API sunucusundan geçerli yanıt alınamadı.",
      response.status,
      payload?.code ?? (payload === null ? "INVALID_RESPONSE" : "REQUEST_FAILED"),
    );
  if (payload === null)
    throw new ApiError("Sunucudan geçersiz yanıt alındı.", 502, "INVALID_RESPONSE");
  return payload as T;
}
