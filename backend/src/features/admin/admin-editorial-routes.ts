import { z } from "zod";
import type { ServerConfig } from "../../config/env";
import { readJson } from "../../shared/http";
import { HttpError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";
import { assertAtlasAdmin } from "./admin-service";
import { listEditorialEntries, readEditorialEntry, reviewEditorialEntry } from "./admin-editorial-service";

const uuid = z.uuid();
const status = z.enum(["all", "machine_validated", "human_reviewed", "quarantined"]);
const reviewBody = z.object({
  expectedRevision: z.number().int().min(1),
  nextStatus: z.enum(["human_reviewed", "quarantined"]),
  reasonCode: z.enum(["editorial_approved", "incorrect_sense", "quality", "unsafe", "other"]),
}).strict();
const listBody = z.object({
  status: status.default("all"),
  word: z.string().max(120).default(""),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
  limit: z.coerce.number().int().min(1).max(30).default(20),
}).strict();

export type AdminEditorialRouteResult = { handled: true; value: unknown } | { handled: false };

/** Called after createApp authenticate(). Only the three exact admin routes are handled. */
export async function tryEditorialAdminRoute(
  request: Request, ctx: RequestContext, config: ServerConfig,
): Promise<AdminEditorialRouteResult> {
  const url = new URL(request.url);
  const path = url.pathname;
  const isList = path === "/api/admin/lexicon" && request.method === "GET";
  const matchDetail = /^\/api\/admin\/lexicon\/([^/]+)$/.exec(path);
  const matchReview = /^\/api\/admin\/lexicon\/([^/]+)\/review$/.exec(path);
  if (!isList && !(matchDetail && request.method === "GET") &&
      !(matchReview && request.method === "POST")) return { handled: false };

  // Authorization FIRST: even malformed queries/bodies cannot probe privileged data.
  assertAtlasAdmin(ctx, config);
  if (isList) {
    const query = url.searchParams;
    if ([...query.keys()].some(k => !["status", "word", "offset", "limit"].includes(k)) ||
        ["status", "word", "offset", "limit"].some(k => query.getAll(k).length > 1)) {
      throw new HttpError(400, "Yönetim filtresi geçersiz.", "ADMIN_FILTER_INVALID");
    }
    const input = listBody.parse({
      status: query.get("status") ?? undefined,
      word: query.get("word") ?? undefined,
      offset: query.get("offset") ?? undefined,
      limit: query.get("limit") ?? undefined,
    });
    const word = input.word.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
    return { handled: true, value: await listEditorialEntries(ctx, config, { ...input, word }) };
  }
  if (matchDetail && request.method === "GET") {
    return { handled: true, value: await readEditorialEntry(ctx, config, uuid.parse(matchDetail[1])) };
  }
  if (matchReview && request.method === "POST") {
    const id = uuid.parse(matchReview[1]);
    const input = reviewBody.parse(await readJson(request, 2048));
    return { handled: true, value: await reviewEditorialEntry(ctx, config, id, input) };
  }
  return { handled: false };
}
