import { dailyGoalSchema } from "@yds-atlas/shared";
import { z } from "zod";
import { accountData } from "../features/learning/account-data";
import { accountState } from "../features/learning/learning-service";
import { databaseError, HttpError } from "../shared/errors";
import { readJson } from "../shared/http";
import { type RouteContext, unmatchedRoute } from "./route-context";

export async function accountRoutes({ request, path, ctx, config }: RouteContext) {
  let result: unknown;
  if (path === "/api/account" && request.method === "GET") result = await accountState(ctx);
  else if (
    [
      "/api/account/plan",
      "/api/account/plan/import",
      "/api/account/export",
      "/api/account/revoke",
      "/api/account/delete",
    ].includes(path)
  )
    result = await accountData(request, path, ctx, config);
  else if (path === "/api/account/goal" && request.method === "PUT") {
    const { goal } = z
      .object({ goal: dailyGoalSchema })
      .strict()
      .parse(await readJson(request));
    const update = await ctx.db.rpc("set_daily_goal", { p_goal: goal });
    databaseError(update.error);
    if (update.data !== goal)
      throw new HttpError(503, "Günlük hedefin kaydedildiği doğrulanamadı.", "GOAL_UNCONFIRMED");
    result = { goal };
  } else return unmatchedRoute;
  return result;
}
