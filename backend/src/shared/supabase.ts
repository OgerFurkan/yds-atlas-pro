import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ServerConfig } from "../config/env";
import { HttpError } from "./errors";
export interface RequestContext {
  userId: string;
  db: SupabaseClient;
}
const timedFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    fetch(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    }),
  { preconnect: fetch.preconnect },
);
export function userClient(config: ServerConfig, token: string) {
  if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY)
    throw new HttpError(503, "Hesap bağlantısı henüz yapılandırılmadı.", "AUTH_NOT_CONFIGURED");
  return createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: "Bearer " + token }, fetch: timedFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
export async function authenticate(
  request: Request,
  config: ServerConfig,
): Promise<RequestContext> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match) throw new HttpError(401, "Devam etmek için hesabına giriş yap.", "UNAUTHENTICATED");
  const db = userClient(config, match[1]);
  const { data, error } = await db.auth.getUser(match[1]);
  if (error && (!error.status || error.status >= 500))
    throw new HttpError(503, "Oturum servisine ulaşılamadı. Yeniden dene.", "AUTH_UNAVAILABLE");
  if (error || !data.user || data.user.is_anonymous)
    throw new HttpError(401, "Oturum doğrulanamadı. Yeniden giriş yap.", "UNAUTHENTICATED");
  return { userId: data.user.id, db };
}
export function quotaClient(config: ServerConfig) {
  if (!config.SUPABASE_URL || !config.SUPABASE_SECRET_KEY)
    throw new HttpError(503, "AI bağlantısı henüz yapılandırılmadı.", "AI_NOT_CONFIGURED");
  return createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    global: { fetch: timedFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
/** Never send this client or its secret to the browser. Only use after authenticate(). */
export function dailyPlanWriterClient(config: ServerConfig): SupabaseClient {
  if (!config.SUPABASE_URL || !config.SUPABASE_SECRET_KEY)
    throw new HttpError(503, "Günlük plan yazma servisi yapılandırılmadı.", "DAILY_PLAN_WRITER_NOT_CONFIGURED");
  return createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    // No user Authorization header: only the verified ctx.userId may be used as owner.
    global: { fetch: timedFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
