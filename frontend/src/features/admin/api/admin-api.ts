import { z } from "zod";
import { apiRequest } from "@/shared/api/api-client";
export const adminOverviewSchema=z.object({
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
export type AdminOverview=z.infer<typeof adminOverviewSchema>;
export async function loadAdminOverview(){
  return adminOverviewSchema.parse(await apiRequest("/api/admin/overview"));
}
export async function checkAdminAccess():Promise<boolean>{
  try {const value=await apiRequest<{admin:boolean}>("/api/admin/me");return value.admin===true;}
  catch{return false;}
}
