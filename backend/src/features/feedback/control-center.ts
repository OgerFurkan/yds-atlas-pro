import { aiWordRequestSchema, editorialCommand, editorialContent } from "@yds-atlas/shared";
import { z } from "zod";
import type { ServerConfig } from "../../config/env";
import { databaseError, HttpError } from "../../shared/errors";
import { readJson } from "../../shared/http";
import { quotaClient, type RequestContext } from "../../shared/supabase";
import type { generateWord } from "../ai/gemini";
import { geminiDiagnostics } from "../ai/gemini-keys";
import { canonicalQuery, meaningKey, validEntry } from "./inspector-validation";

export async function controlCenter(
  request: Request,
  ctx: RequestContext,
  config: ServerConfig,
  generate: typeof generateWord,
  beginAi: () => Promise<void>,
  operations?: () => Promise<unknown>,
) {
  if (!config.ATLAS_CONTROL_OWNER_ID || config.ATLAS_CONTROL_OWNER_ID !== ctx.userId)
    throw new HttpError(403, "Yönetim yetkisi gerekli.", "CONTROL_DENIED");
  const mfa = await ctx.db.rpc("atlas_control_mfa");
  databaseError(mfa.error);
  if (mfa.data !== true)
    throw new HttpError(403, "İkinci faktör doğrulaması gerekli.", "CONTROL_MFA");
  const url = new URL(request.url),
    path = url.pathname;
  if (path === "/api/control" && request.method === "GET") return { authorized: true };
  if (path === "/api/control/operations" && request.method === "GET" && operations)
    return operations();
  if (path === "/api/control/ai-status" && request.method === "GET")
    return geminiDiagnostics(config);
  if (path === "/api/control/draft" && request.method === "POST") {
    const { word } = aiWordRequestSchema.parse(await readJson(request, 2048));
    if (!config.GEMINI_KEYS.length)
      throw new HttpError(503, "AI yapılandırılmadı.", "AI_NOT_CONFIGURED");
    await beginAi();
    const draft = await generate(word, config, request.signal);
    return {
      content: editorialContent.parse(draft.suggestion),
      provenance: { source: "ai-reviewed", license: "Atlas Original" },
    };
  }
  const db = quotaClient(config);
  if (path === "/api/control/legacy" && request.method === "GET") {
    const word = canonicalQuery(
      aiWordRequestSchema.parse({ word: url.searchParams.get("word") }),
    ).word;
    const { data, error, count } = await db
      .from("atlas_lexicon_entries")
      .select("id,revision,digest,content,provenance", { count: "exact" })
      .eq("word_key", word)
      .eq("part_of_speech", "Tooltip")
      .limit(100);
    databaseError(error);
    if (!data || data.length !== count)
      throw new HttpError(503, "Tarihsel kayıt eksik.", "CONTROL_INCOMPLETE");
    return data;
  }
  if (path === "/api/control/entries" && request.method === "GET") {
    const word = aiWordRequestSchema.parse({ word: url.searchParams.get("word") }).word;
    const { data, error, count } = await db
      .from("atlas_lexicon_entries")
      .select("id,revision,status,content,provenance", { count: "exact" })
      .eq("word_key", canonicalQuery({ word }).word)
      .neq("part_of_speech", "Tooltip")
      .limit(100);
    databaseError(error);
    if (!data || data.length !== count)
      throw new HttpError(503, "Kayıtlar eksik.", "CONTROL_INCOMPLETE");
    return data;
  }
  if (path === "/api/control/history" && request.method === "GET") {
    const id = z.uuid().parse(url.searchParams.get("id"));
    const { data, error } = await db
      .from("atlas_lexicon_entry_revisions")
      .select("revision,status,action,reason_code,created_at,actor_id,content,provenance")
      .eq("entry_id", id)
      .order("revision", { ascending: false })
      .lt(
        "revision",
        z.coerce
          .number()
          .int()
          .positive()
          .parse(url.searchParams.get("before") ?? 2147483647),
      )
      .limit(50);
    databaseError(error);
    return data;
  }
  if (path === "/api/control/revisions" && request.method === "POST") {
    const cmd = editorialCommand.parse(await readJson(request, 1000000));
    let restoredSense: string | undefined;
    if (cmd.action === "restore") {
      const prior = await db
        .from("atlas_lexicon_entry_revisions")
        .select("content")
        .eq("entry_id", cmd.entryId)
        .eq("revision", cmd.target)
        .eq("status", "human_reviewed")
        .maybeSingle();
      databaseError(prior.error);
      if (!prior.data)
        throw new HttpError(409, "Onaylanmış revizyon bulunamadı.", "EDITORIAL_CONFLICT");
      restoredSense = meaningKey(editorialContent.parse(prior.data.content).meanings[0]);
    }
    const rows =
      cmd.action === "publish"
        ? cmd.items.map((item) => {
            const c = item.content,
              wordKey = canonicalQuery({ word: c.word }).word,
              senseKey = meaningKey(c.meanings[0]);
            if (
              !validEntry({
                id: item.entryId ?? "",
                revision: 1,
                status: "human_reviewed",
                content: c,
                word_key: wordKey,
                sense_key: senseKey,
                part_of_speech: c.partOfSpeech,
              })
            )
              throw new HttpError(
                422,
                "Anlam, tür, çeviri veya 2/1/2 örnek düzeni geçersiz.",
                "EDITORIAL_INVALID",
              );
            return { ...item, action: cmd.action, wordKey, senseKey };
          })
        : [{ ...cmd, senseKey: restoredSense }];
    const { data, error } = await db.rpc("atlas_apply_editorial", {
      p_actor: ctx.userId,
      p_operation: cmd.operation,
      p_items: rows,
    });
    if (error && ["40001", "23505", "P0002"].includes(error.code))
      throw new HttpError(
        409,
        "İçerik sürümü veya kimliği değişti. Güncel kaydı incele.",
        "EDITORIAL_CONFLICT",
      );
    databaseError(error);
    return data;
  }
  throw new HttpError(404, "Yönetim işlemi bulunamadı.", "NOT_FOUND");
}
