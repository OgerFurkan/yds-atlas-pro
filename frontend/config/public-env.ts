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
}
