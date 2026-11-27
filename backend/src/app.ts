import type { ServerConfig } from "./config/env";
import { createAiAdmission } from "./features/ai/ai-admission";
import { createAssessmentWriter } from "./features/learning/assessment-writer";
import { createOperations } from "./features/operations/operations";
import { accountRoutes } from "./routes/account-routes";
import { aiRoutes } from "./routes/ai-routes";
import { controlRoutes } from "./routes/control-routes";
import { learningRoutes } from "./routes/learning-routes";
import { lexiconRoutes } from "./routes/lexicon-routes";
import { operationsRoutes } from "./routes/operations-routes";
import { type Dependencies, type RouteContext, unmatchedRoute } from "./routes/route-context";
import { wordsRoutes } from "./routes/words-routes";
import { errorResponse } from "./shared/error-response";
import { HttpError } from "./shared/errors";
import { authenticate } from "./shared/supabase";

const domainRoutes = [lexiconRoutes, wordsRoutes, accountRoutes, learningRoutes, aiRoutes];

export function createApp(config: ServerConfig, dependencies: Dependencies = {}) {
  const assessmentWriter =
    dependencies.assessmentWriter ??
    createAssessmentWriter(config.SUPABASE_ASSESSMENT_DATABASE_URL);
  const operations = createOperations(
    config,
    assessmentWriter.ping?.bind(assessmentWriter),
    dependencies.readiness,
  );
  const origins = new Set(
    config.APP_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const admitAi = createAiAdmission(config, dependencies.consumeQuota);

  const handle = async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const origin = request.headers.get("origin");
    const { beginAi, release } = admitAi(request.signal);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
      Vary: "Origin",
    });
    if (origin && origins.has(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Expose-Headers", "Retry-After");
      headers.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Atlas-Expected-Updated-At",
      );
      headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }
    try {
      if (origin && !origins.has(origin))
        throw new HttpError(403, "Bu kaynaktan erişime izin verilmiyor.", "ORIGIN_REJECTED");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      const path = new URL(request.url).pathname;
      const publicResponse = await operationsRoutes(request, path, headers, config, operations);
      if (publicResponse) return publicResponse;
      if (!path.startsWith("/api/")) throw new HttpError(404, "İstek bulunamadı.", "NOT_FOUND");
      const ctx = await (dependencies.authenticate?.(request) ?? authenticate(request, config));
      const route = {
        request,
        path,
        ctx,
        config,
        dependencies,
        beginAi,
        assessmentWriter,
      } satisfies RouteContext;
      const control = await controlRoutes(route, operations.snapshot);
      if (control !== unmatchedRoute) return Response.json(control, { headers });
      for (const routeHandler of domainRoutes) {
        const result = await routeHandler(route);
        if (result !== unmatchedRoute) return Response.json(result, { headers });
      }
      throw new HttpError(404, "İstek bulunamadı.", "NOT_FOUND");
    } catch (error) {
      return errorResponse(error, requestId, headers);
    } finally {
      release();
    }
  };
  return async (request: Request) => {
    const started = performance.now();
    const response = await handle(request);
    operations.observe(response.status, performance.now() - started);
    return response;
  };
}
