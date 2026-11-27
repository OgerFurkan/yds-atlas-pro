import type { ServerConfig } from "../config/env";
import type { createOperations } from "../features/operations/operations";
export async function operationsRoutes(
  request: Request,
  path: string,
  headers: Headers,
  config: ServerConfig,
  operations: ReturnType<typeof createOperations>,
) {
  if (path === "/api/ready" && request.method === "GET") {
    const ready = await operations.readiness();
    const ok = ready.database && ready.auth;
    return Response.json(
      { status: ok ? "ready" : "unavailable" },
      { headers, status: ok ? 200 : 503 },
    );
  }
  if (path === "/api/health" && request.method === "GET")
    return Response.json(
      {
        status: "ok",
        databaseConfigured: !!(config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY),
        aiConfigured: !!(config.GEMINI_KEYS.length && config.SUPABASE_SECRET_KEY),
        tooltip: { enabled: false },
      },
      { headers },
    );
  return null;
}
