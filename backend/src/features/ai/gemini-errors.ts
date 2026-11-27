import { HttpError } from "../../shared/errors";

type ProviderError = {
  error?: {
    details?: {
      reason?: string;
      retryDelay?: string;
      violations?: { quotaId?: string; quotaMetric?: string }[];
    }[];
  };
};

function retrySeconds(payload: ProviderError | null, response: Response) {
  const details = payload?.error?.details;
  const waits: number[] = [];
  for (const entry of Array.isArray(details) ? details : []) {
    if (typeof entry?.retryDelay === "string" && /^\d+(?:\.\d+)?s$/.test(entry.retryDelay))
      waits.push(Math.ceil(Number.parseFloat(entry.retryDelay)));
  }
  const header = response.headers.get("retry-after")?.trim();
  if (header && /^\d+$/.test(header)) waits.push(Number(header));
  else if (header) waits.push(Math.ceil((Date.parse(header) - Date.now()) / 1000));
  const valid = waits.filter(
    (seconds) => Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 8e12,
  );
  return valid.length ? Math.max(1, ...valid) : undefined;
}

export async function providerQuota(response: Response) {
  const payload = (await response.json().catch(() => null)) as ProviderError | null;
  const details = payload?.error?.details;
  const kinds = new Set<string>();
  for (const detail of Array.isArray(details) ? details : []) {
    for (const violation of Array.isArray(detail?.violations) ? detail.violations : []) {
      const id = typeof violation?.quotaId === "string" ? violation.quotaId.toLowerCase() : "";
      if (id.includes("perday")) kinds.add("daily");
      if (id.includes("perminute"))
        kinds.add(id.includes("token") ? "tokens_per_minute" : "requests_per_minute");
    }
  }
  return { wait: retrySeconds(payload, response), kind: kinds.size ? [...kinds] : ["unknown"] };
}

// Never return provider bodies: they may contain request content or credentials.
export async function assertGeminiResponse(response: Response, service = "gemini"): Promise<void> {
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as ProviderError | null;
  const details = payload?.error?.details;
  const reasons = (Array.isArray(details) ? details : [])
    .map((detail) => detail?.reason)
    .filter((reason): reason is string => Boolean(reason));
  console.error({
    service,
    stage: "upstream_error",
    status: response.status,
  });
  const invalidKey = reasons?.some((reason) =>
    ["API_KEY_INVALID", "API_KEY_EXPIRED"].includes(reason),
  );
  if (response.status === 403 && !invalidKey)
    throw new HttpError(
      503,
      "Gemini erişim izni yetersiz. Yöneticiye bildir.",
      "AI_PERMISSION_DENIED",
    );
  if (invalidKey || response.status === 401)
    throw new HttpError(
      503,
      "Gemini erişim anahtarı geçersiz. Yöneticiye bildir.",
      "AI_AUTH_ERROR",
    );
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
        ? `Gemini sağlayıcı limitine ulaşıldı. ${wait} saniye sonra tekrar dene.`
        : "Gemini istek sınırına ulaşıldı. Bir dakika sonra tekrar dene.",
      "AI_QUOTA_EXCEEDED",
      wait,
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
