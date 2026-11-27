import { accountPlanSchema, privatePlanSchema, wordInputSchema } from "@yds-atlas/shared";
import { z } from "zod";
import type { ServerConfig } from "../../config/env";
import { databaseError, HttpError } from "../../shared/errors";
import { readJson } from "../../shared/http";
import type { RequestContext } from "../../shared/supabase";
import { assertFeedbackWordBindings } from "../feedback/inspector-service";
import { normalizeInput } from "../words/word-service";

const mutation = z
  .object({
    owner: z.uuid(),
    revision: z.number().int().nonnegative(),
    command: z.uuid(),
    plan: privatePlanSchema,
  })
  .strict();
const dayImport = mutation.extend({
  createOnly: z.boolean().optional(),
  day: z.number().int().min(1).max(60),
  words: z.array(wordInputSchema).min(1).max(40),
});
function owner(ctx: RequestContext, id: string) {
  if (id !== ctx.userId)
    throw new HttpError(403, "Hesap değişti. İşlem durduruldu.", "OWNER_CHANGED");
}
export async function accountData(
  request: Request,
  path: string,
  ctx: RequestContext,
  config: ServerConfig,
) {
  if (path === "/api/account/plan" || path === "/api/account/plan/import") {
    let response: Awaited<ReturnType<RequestContext["db"]["rpc"]>>;
    let imported = false;
    if (path.endsWith("/import") && request.method === "POST") {
      const input = dayImport.parse(await readJson(request));
      owner(ctx, input.owner);
      await assertFeedbackWordBindings(config, input.words, true);
      response = await ctx.db.rpc("atlas_import_to_day", {
        p_revision: input.revision,
        p_command: input.command,
        p_base: input.plan,
        p_create_only: input.createOnly ?? false,
        p_day: input.day,
        p_words: input.words.map(normalizeInput),
      });
      imported = true;
    } else if (path.endsWith("/plan") && request.method === "PUT") {
      const input = mutation.parse(await readJson(request));
      owner(ctx, input.owner);
      response = await ctx.db.rpc("atlas_save_plan", {
        p_revision: input.revision,
        p_command: input.command,
        p_plan: input.plan,
      });
    } else if (path.endsWith("/plan") && request.method === "GET")
      response = await ctx.db.rpc("atlas_read_plan");
    else throw new HttpError(405, "İşlem desteklenmiyor.");
    if (response.error?.code === "40001")
      throw new HttpError(
        409,
        "Plan değişti. Güncel planı yükleyip seçimini yeniden yap.",
        "PLAN_CONFLICT",
      );
    if (response.error?.code === "22023")
      throw new HttpError(422, "Plan veya gün kapasitesi geçersiz.", "INVALID_PLAN");
    databaseError(response.error);
    const state = accountPlanSchema.parse(response.data);
    owner(ctx, state.owner);
    return imported
      ? {
          ...state,
          ...z
            .object({
              added: z.number().int().nonnegative(),
              duplicates: z.number().int().nonnegative(),
            })
            .parse(response.data),
        }
      : state;
  }
  if (request.method !== "POST") throw new HttpError(405, "İşlem desteklenmiyor.");
  const input = z
    .object({ owner: z.uuid(), confirm: z.literal(true) })
    .strict()
    .parse(await readJson(request, 1024));
  owner(ctx, input.owner);
  const confirmation = await ctx.db.rpc("atlas_confirm_account", { p_owner: ctx.userId });
  databaseError(confirmation.error);
  if (confirmation.data !== true)
    throw new HttpError(403, "Son beş dakika içinde yeniden giriş yapmalısın.", "REAUTH_REQUIRED");
  if (path === "/api/account/export") {
    const result = await ctx.db.rpc("atlas_export_account", { p_owner: ctx.userId });
    if (result.error?.code === "54000")
      throw new HttpError(413, "Güvenli dışa aktarım boyut sınırı aşıldı.", "EXPORT_LIMIT");
    databaseError(result.error);
    const archive = result.data;
    owner(ctx, archive?.owner);
    const collections = [
      "profile",
      "words",
      "sessions",
      "results",
      "wordCompletions",
      "goalDays",
      "usage",
      "plan",
    ];
    if (
      archive.format !== 1 ||
      !z.iso.datetime({ offset: true }).safeParse(archive.at).success ||
      collections.some(
        (key) =>
          !Array.isArray(archive.data?.[key]) || archive.counts?.[key] !== archive.data[key].length,
      )
    )
      throw new HttpError(
        503,
        "Hesap dışa aktarımının bütünlüğü doğrulanamadı.",
        "EXPORT_INCOMPLETE",
      );
    return archive;
  }
  if (path === "/api/account/revoke") {
    const bearer = request.headers.get("authorization")?.slice(7);
    if (!bearer) throw new HttpError(401, "Oturum do\u011frulanamad\u0131.", "UNAUTHENTICATED");
    const result = await ctx.db.auth.admin.signOut(bearer, "global");
    if (result.error)
      throw new HttpError(503, "Oturum kapatma doğrulanamadı.", "REVOKE_UNCONFIRMED");
    return { revoked: true };
  }
  throw new HttpError(
    503,
    "Bağımsız silme kaydı ve kurtarma kabulü tamamlanmadı. Hesap silme kapalı.",
    "DELETION_DISABLED",
  );
}
