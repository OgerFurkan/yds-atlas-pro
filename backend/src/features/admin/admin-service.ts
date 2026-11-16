import { z } from "zod";
import type { RequestContext } from "../../shared/supabase";
import type { ServerConfig } from "../../config/env";
import { quotaClient } from "../../shared/supabase";
import { databaseError, HttpError } from "../../shared/errors";

const overviewSchema=z.object({
  periodDays:z.number().int().positive(),
  totalPoolEntries:z.number().int().nonnegative(),
  humanReviewed:z.number().int().nonnegative(),
  machineValidated:z.number().int().nonnegative(),
  quarantined:z.number().int().nonnegative(),
  measuredEvents:z.number().int().nonnegative(),
  measuredUsers:z.number().int().nonnegative(),
  chatPoolHits:z.number().int().nonnegative(),
  chatAiRequests:z.number().int().nonnegative(),
  recommendPoolHits:z.number().int().nonnegative(),
  generatedEntries:z.number().int().nonnegative(),
  inputTokens:z.number().int().nonnegative().nullable(),
  outputTokens:z.number().int().nonnegative().nullable(),
  estimatedCostUsd:z.number().nonnegative().nullable(),
  metricsComplete:z.boolean(),
}).strict();

export function assertAtlasAdmin(ctx:RequestContext,config:ServerConfig){
  // Authenticated Supabase user ID matches a private server-only env setting.
  // No browser role claims, user_metadata, email text or local storage access.
  if(!config.ATLAS_ADMIN_USER_ID||ctx.userId!==config.ATLAS_ADMIN_USER_ID)
    throw new HttpError(403,"Yönetim merkezi için yetkin yok.","ADMIN_FORBIDDEN");
}

export async function adminOverview(ctx:RequestContext,config:ServerConfig){
  assertAtlasAdmin(ctx,config);
  const {data,error}=await quotaClient(config).rpc("atlas_admin_overview_v1");
  databaseError(error);
  const parsed=overviewSchema.safeParse(data);
  if(!parsed.success)throw new HttpError(503,"Metrik sözleşmesi doğrulanamadı.","ADMIN_METRIC_INVALID");
  return parsed.data;
}
