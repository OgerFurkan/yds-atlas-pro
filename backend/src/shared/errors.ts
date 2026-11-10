export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export function databaseError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "23505")
    throw new HttpError(409, "Bu kelime kütüphanende zaten var.", "DUPLICATE_WORD");
  if (error.code === "40001")
    throw new HttpError(
      409,
      "Görev başka bir sekmede değişti. Sayfayı yenileyip devam et.",
      "SESSION_CONFLICT",
    );
  if (error.code === "42501" || error.code === "PGRST301")
    throw new HttpError(403, "Bu kayda erişim iznin yok.", "FORBIDDEN");
  throw new HttpError(
    503,
    "Veri kaynağına ulaşılamadı. Lütfen yeniden dene.",
    "DATABASE_UNAVAILABLE",
  );
}
