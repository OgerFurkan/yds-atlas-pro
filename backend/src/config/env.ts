import { z } from "zod";
const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);
const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("127.0.0.1"),
  APP_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  SUPABASE_URL: optional.pipe(z.url().optional()),
  SUPABASE_PUBLISHABLE_KEY: optional,
  SUPABASE_SECRET_KEY: optional,
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z
    .string()
    .regex(/^gemini-[a-z0-9.-]+$/)
    .default("gemini-3.8-flash"),
});
export type ServerConfig = z.infer<typeof schema>;
export function readConfig(values: Record<string, string | undefined>): ServerConfig {
  const parsed = schema.safeParse(values);
  if (!parsed.success)
    throw new Error(
      "Sunucu ortam ayarları geçersiz: " +
        parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
    );
  return parsed.data;
}
