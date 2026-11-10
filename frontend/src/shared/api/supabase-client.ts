import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();
function unsafeKey(value: string) {
  if (value.startsWith("sb_secret_")) return true;
  try {
    return (
      JSON.parse(atob((value.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/"))).role ===
      "service_role"
    );
  } catch {
    return false;
  }
}
function validUrl(value: string) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))
    );
  } catch {
    return false;
  }
}
export const supabaseConfigurationError =
  !url && !key
    ? ""
    : !url || !key
      ? "Supabase bağlantı ayarları eksik."
      : !validUrl(url)
        ? "Supabase proje adresi geçersiz."
        : unsafeKey(key)
          ? "Tarayıcı için yalnızca publishable anahtar kullanılabilir."
          : "";
export const supabase =
  url && key && !supabaseConfigurationError
    ? createClient(url, key, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
