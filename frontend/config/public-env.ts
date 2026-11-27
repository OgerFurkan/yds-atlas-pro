import { hostedIdentity, origin } from "@yds-atlas/shared/environment-identity";
export function assertPublicEnvironment(env: Record<string, string | undefined>) {
  if (
    Object.entries(env).some(
      ([name, value]) => value && /^VITE_.*(GEMINI|SERVICE_ROLE|SECRET)/i.test(name),
    )
  ) {
    throw new Error("Gizli anahtarlar VITE_ değişkenlerinde tutulamaz. Backend ortamını kullan.");
  }
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "";
  let elevated = key.startsWith("sb_secret_");
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8"));
    elevated ||= payload.role === "service_role";
  } catch {
    /* A publishable key is not a JWT. */
  }
  if (elevated)
    throw new Error("Tarayıcı için Supabase publishable key kullan. Gizli anahtar derlenmedi.");
  const mode = env.VITE_ATLAS_ENV || "local";
  if (!["local", "pre", "prod"].includes(mode)) throw new Error("Invalid VITE_ATLAS_ENV.");
  const identity =
    mode === "local" ? null : hostedIdentity(env.ATLAS_HOSTED_IDENTITIES, mode as "pre" | "prod");
  for (const [name, input, expected] of [
    ["VITE_SUPABASE_URL", env.VITE_SUPABASE_URL, identity?.supabase],
    ["VITE_API_URL", env.VITE_API_URL, identity?.api],
  ] as const) {
    if (!input && !identity) continue;
    let normalized: string;
    try {
      normalized = origin(input ?? "", !!identity);
    } catch {
      throw new Error(`Invalid public environment binding: ${name}`);
    }
    if (expected && normalized !== expected)
      throw new Error(`Invalid public environment binding: ${name}`);
  }
  if (identity && !key) throw new Error("Hosted browser builds require a public Supabase key.");
  if (identity && key.includes(".")) {
    const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    if (payload.role !== "anon" || payload.ref !== identity.project)
      throw new Error("Invalid browser Supabase project key.");
  }
}
