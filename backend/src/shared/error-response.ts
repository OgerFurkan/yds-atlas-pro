import { z } from "zod";
import { HttpError } from "./errors";

export function errorResponse(error: unknown, requestId: string, headers: Headers) {
  const known =
    error instanceof HttpError
      ? error
      : error instanceof z.ZodError
        ? new HttpError(
            400,
            "Gönderilen bilgiler geçersiz. Alanları kontrol et.",
            "VALIDATION_ERROR",
          )
        : new HttpError(500, "İşlem tamamlanamadı. Yeniden deneyebilirsin.", "INTERNAL_ERROR");
  if (known.status >= 500) console.error({ requestId, code: known.code, status: known.status });
  if (known.status === 429) headers.set("Retry-After", String(known.retryAfterSeconds ?? 60));
  return Response.json(
    {
      error: known.message,
      code: known.code,
      requestId,
      ...(known.wordFailures?.length ? { failures: known.wordFailures } : {}),
      ...(known.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: known.retryAfterSeconds }),
    },
    { status: known.status, headers },
  );
}
