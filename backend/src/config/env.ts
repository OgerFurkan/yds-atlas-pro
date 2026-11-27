import { hostedIdentity, loopback, origin } from "@yds-atlas/shared/environment-identity";
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

// Credentials rotate for availability. Google measures quotas at the project level.
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
    ATLAS_ENV: z.enum(["local", "pre", "prod"]).default("local"),
    ATLAS_RELEASE: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    ATLAS_RECOVERY_STATUS_FILE: optional,
    ATLAS_RECOVERY_STATUS_PUBLIC_KEY: z
      .string()
      .max(128)
      .regex(/^[a-zA-Z0-9+/]+={0,2}$/)
      .optional(),
    ATLAS_CONTROL_OWNER_ID: z.uuid().optional(),
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

export function readRuntimeConfig(values: Record<string, string | undefined>): ServerConfig {
  const environment = values.ATLAS_ENV ?? (values.NODE_ENV === "production" ? undefined : "local");
  if (environment !== "local" && environment !== "pre" && environment !== "prod")
    throw new Error("ATLAS_ENV must be local, pre or prod.");
  const config = readConfig({
    ...values,
    ATLAS_ENV: environment,
    ATLAS_RELEASE: values.ATLAS_RELEASE ?? values.RENDER_GIT_COMMIT,
  });
  const hosted = environment !== "local";
  const verify = (key: string, valid: boolean) => {
    if (!valid) throw new Error(`Invalid environment binding: ${key}`);
  };
  const identity = hosted ? hostedIdentity(values.ATLAS_HOSTED_IDENTITIES, environment) : null;
  if (!hosted) verify("HOST", ["localhost", "127.0.0.1", "::1"].includes(config.HOST));
  const origins = config.APP_ORIGINS.split(",").map((item) => item.trim());
  for (const item of origins) {
    let normalized: string;
    try {
      normalized = origin(item, hosted);
    } catch {
      throw new Error("Invalid environment binding: APP_ORIGINS");
    }
    verify("APP_ORIGINS", normalized === item && (!identity || item === identity.web));
  }
  verify("SUPABASE_URL", Boolean(config.SUPABASE_URL) === Boolean(config.SUPABASE_PUBLISHABLE_KEY));
  if (config.SUPABASE_URL) {
    const account = origin(config.SUPABASE_URL, hosted);
    verify("SUPABASE_URL", !identity || account === identity.supabase);
  }
  const key = config.SUPABASE_PUBLISHABLE_KEY ?? "";
  const claims = key.split(".")[1];
  let role: unknown;
  let ref: unknown;
  if (claims) {
    try {
      ({ role, ref } = JSON.parse(Buffer.from(claims, "base64url").toString("utf8")));
    } catch {
      throw new Error("Invalid publishable JWT.");
    }
  }
  verify(
    "SUPABASE_PUBLISHABLE_KEY",
    !key.startsWith("sb_secret_") &&
      (!claims || (role === "anon" && (!identity || ref === identity.project))),
  );
  if (config.SUPABASE_ASSESSMENT_DATABASE_URL) {
    const database = new URL(config.SUPABASE_ASSESSMENT_DATABASE_URL);
    const options = [...database.searchParams.keys()];
    const safeOptions = options.every((name) => name === "sslmode") && options.length <= 1;
    verify(
      "SUPABASE_ASSESSMENT_DATABASE_URL",
      safeOptions &&
        !database.hash &&
        database.pathname === "/postgres" &&
        (identity
          ? database.hostname === identity.assessment.host &&
            Number(database.port || 5432) === identity.assessment.port &&
            database.username === identity.assessment.user &&
            database.searchParams.get("sslmode") === "verify-full"
          : loopback(database) && database.username === "atlas_assessment_api"),
    );
  }
  if (identity) {
    verify("NODE_TLS_REJECT_UNAUTHORIZED", values.NODE_TLS_REJECT_UNAUTHORIZED !== "0");
    verify("SUPABASE_URL", Boolean(config.SUPABASE_URL));
    verify("SUPABASE_ASSESSMENT_DATABASE_URL", Boolean(config.SUPABASE_ASSESSMENT_DATABASE_URL));
    if (
      config.ATLAS_FEEDBACK_LEXICON_ENABLED ||
      config.GEMINI_KEYS.length ||
      config.ATLAS_CONTROL_OWNER_ID
    )
      verify("SUPABASE_SECRET_KEY", Boolean(config.SUPABASE_SECRET_KEY));
  }
  return config;
}
