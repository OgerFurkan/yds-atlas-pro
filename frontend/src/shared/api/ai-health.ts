import { z } from "zod";

const poolSchema = z.object({
  readyKeys: z.number().int().nonnegative(),
  waitSeconds: z.number().int().positive().nullable(),
});

const aiHealthSchema = z.object({
  status: z.literal("ok"),
  databaseConfigured: z.boolean(),
  aiConfigured: z.boolean(),
  ai: z
    .object({
      configured: z.boolean(),
      keyCount: z.number().int().nonnegative(),
      quotaConfigured: z.boolean(),
      modelWord: z.string(),
      modelChat: z.string(),
      word: poolSchema,
      chat: poolSchema,
    })
    .optional(),
});

export type AiHealth = z.infer<typeof aiHealthSchema>;

const UNREACHABLE = "API sunucusuna ulaşılamadı.";

// Health is public, so it uses a plain fetch instead of the authenticated API client.
export async function fetchAiHealth(signal?: AbortSignal): Promise<AiHealth> {
  const base = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
  const timeout = AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await fetch(`${base}/api/health`, {
      headers: { Accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new Error(UNREACHABLE);
  }
  if (!response.ok) throw new Error(`Sağlık kontrolü başarısız (HTTP ${response.status}).`);
  const payload = await response.json().catch(() => null);
  const parsed = aiHealthSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Sağlık yanıtı beklenen biçimde değil.");
  return parsed.data;
}
