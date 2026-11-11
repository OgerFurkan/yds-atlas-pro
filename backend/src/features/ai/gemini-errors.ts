import { HttpError } from "../../shared/errors";

// Never return provider bodies: they may contain request content or credentials.
export async function assertGeminiResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as {
    error?: { details?: { reason?: string }[] };
  } | null;
  const invalidKey = payload?.error?.details?.some((detail) =>
    ["API_KEY_INVALID", "API_KEY_EXPIRED"].includes(detail.reason ?? ""),
  );
  if (invalidKey || response.status === 401 || response.status === 403)
    throw new HttpError(503, "Gemini API anahtarı veya proje erişimi reddedildi.", "AI_AUTH_ERROR");
  if (response.status === 404)
    throw new HttpError(
      503,
      "Gemini modeline erişilemiyor. Sunucunun model ayarı kontrol edilmeli.",
      "AI_MODEL_NOT_FOUND",
    );
  if (response.status === 429)
    throw new HttpError(
      429,
      "AI kullanım sınırına ulaşıldı. Daha sonra tekrar dene.",
      "AI_QUOTA_EXCEEDED",
    );
  if (response.status === 400)
    throw new HttpError(
      502,
      "Gemini isteği kabul etmedi. Sunucunun AI ayarları kontrol edilmeli.",
      "AI_REQUEST_REJECTED",
    );
  throw new HttpError(
    502,
    "Gemini şu anda yanıt veremiyor. Biraz sonra yeniden dene.",
    "AI_UPSTREAM_ERROR",
  );
}
