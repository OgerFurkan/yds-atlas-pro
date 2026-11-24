import { z } from "zod";

const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);
const modelName = z
  .string()
  .trim()
  .regex(/^gemini-[a-z0-9.-]+$/);

// Gemini quota is applied per project, so a pool only helps when every key belongs
// to a separate project. Duplicates are removed to avoid retrying a key twice.
function apiKeys(...values: (string | undefined)[]) {
  return [
    ...new Set(
      values
        .flatMap((value) => (value ?? "").split(/[\s,]+/))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

const schema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default("127.0.0.1"),
    APP_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
    SUPABASE_URL: optional.pipe(z.url().optional()),
    SUPABASE_PUBLISHABLE_KEY: optional,
    SUPABASE_SECRET_KEY: optional,
    SUPABASE_ASSESSMENT_DATABASE_URL: optional.pipe(
      z.url({ protocol: /^postgres(?:ql)?$/ }).optional(),
    ),
    ATLAS_FEEDBACK_LEXICON_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    GEMINI_API_KEY: optional,
    GEMINI_API_KEYS: optional,
    // Optional ordered project aliases, one per deduplicated key.
    GEMINI_KEY_PROJECT_GROUPS: optional,
    GEMINI_MODEL_WORD: modelName.default("gemini-3.5-flash-lite"),
    GEMINI_MODEL_CHAT: modelName.default("gemini-3.5-flash-lite"),
  })
  .transform((value) => {
    const GEMINI_KEYS = apiKeys(value.GEMINI_API_KEYS, value.GEMINI_API_KEY);
    const ids = value.GEMINI_KEY_PROJECT_GROUPS?.split(",").map((group) => group.trim()) ?? [];
    if (
      ids.length &&
      (ids.length !== GEMINI_KEYS.length ||
        !ids.every((group) => /^[a-z0-9_-]{1,40}$/i.test(group)))
    ) {
      throw new Error("GEMINI_KEY_PROJECT_GROUPS must match unique key order");
    }
    return { ...value, GEMINI_KEYS, GEMINI_KEY_GROUP_IDS: ids };
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
