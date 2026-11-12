import { HttpError } from "../../shared/errors";

type ProviderError = {
  error?: { status?: string; details?: { reason?: string; retryDelay?: string }[] };
};

function retrySeconds(payload: ProviderError | null, response: Response) {
  const fromDetails = payload?.error?.details
    ?.map((detail) => Number.parseFloat(detail.retryDelay ?? ""))
    .find((seconds) => Number.isFinite(seconds) && seconds > 0);
  if (fromDetails) return Math.max(1, Math.ceil(fromDetails));
  const header = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  return Number.isFinite(header) && header > 0 ? header : undefined;
}

// Google usually sends retryDelay in a 429 body, sometimes only a Retry-After header.
export async function retryDelaySeconds(response: Response) {
  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as ProviderError | null;
  return retrySeconds(payload, response);
}

// Never return provider bodies: they may contain request content or credentials.
export async function assertGeminiResponse(response: Response, service = "gemini"): Promise<void> {
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as ProviderError | null;
  const reasons = payload?.error?.details
    ?.map((detail) => detail.reason)
    .filter((reason): reason is string => Boolean(reason));
  console.error({
    service,
    stage: "upstream_error",
    status: response.status,
    providerStatus: payload?.error?.status,
    reasons,
  });
  const invalidKey = reasons?.some((reason) =>
    ["API_KEY_INVALID", "API_KEY_EXPIRED"].includes(reason),
  );
  if (invalidKey || response.status === 401 || response.status === 403)
    throw new HttpError(503, "Gemini API anahtarı veya proje erişimi reddedildi.", "AI_AUTH_ERROR");
  if (response.status === 404)
    throw new HttpError(
      503,
      "Gemini modeline erişilemiyor. Sunucunun model ayarı kontrol edilmeli.",
      "AI_MODEL_NOT_FOUND",
    );
  if (response.status === 429) {
    const wait = retrySeconds(payload, response);
    throw new HttpError(
      429,
      wait
        ? `Gemini dakikalık istek sınırına ulaşıldı. ${wait} saniye sonra tekrar dene.`
        : "Gemini istek sınırına ulaşıldı. Bir dakika sonra tekrar dene.",
      "AI_QUOTA_EXCEEDED",
    );
  }
  if (response.status === 400)
    throw new HttpError(
      502,
      "Gemini isteği kabul etmedi. Sunucunun AI ayarları kontrol edilmeli.",
      "AI_REQUEST_REJECTED",
    );
  throw new HttpError(
    502,
    `Gemini şu anda yanıt veremiyor (HTTP ${response.status}). Biraz sonra yeniden dene.`,
    "AI_UPSTREAM_ERROR",
  );
}
