import { generateWord } from "../features/ai/gemini";
import { controlCenter } from "../features/feedback/control-center";
import type { createOperations } from "../features/operations/operations";
import { type RouteContext, unmatchedRoute } from "./route-context";
export async function controlRoutes(
  { path, request, ctx, config, dependencies, beginAi }: RouteContext,
  snapshot: ReturnType<typeof createOperations>["snapshot"],
) {
  if (path !== "/api/control" && !path.startsWith("/api/control/")) return unmatchedRoute;
  return controlCenter(
    request,
    ctx,
    config,
    dependencies.generate ?? generateWord,
    () => beginAi(ctx.userId),
    snapshot,
  );
}
