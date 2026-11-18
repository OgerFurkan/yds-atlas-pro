import type { SupabaseClient } from "@supabase/supabase-js";
import { hasCompleteTierSet } from "@yds-atlas/shared";
import type { ServerConfig } from "../../config/env";
import { databaseError, HttpError } from "../../shared/errors";
import { quotaClient, type RequestContext } from "../../shared/supabase";
import { lexicalIdentity } from "../lexicon/lexicon-identity";
import { validateLexicalCandidate } from "../lexicon/lexicon-content-validator";
import { assertAtlasAdmin } from "./admin-service";

export type EditorialStatus = "machine_validated" | "human_reviewed" | "quarantined";
export type EditorialReason = "editorial_approved" | "incorrect_sense" | "quality" | "unsafe" | "other";
export type EditorialListFilters = {
  status: EditorialStatus | "all";
  word: string;
  offset: number;
  limit: number;
};
export type EditorialReview = {
  expectedRevision: number;
  nextStatus: "human_reviewed" | "quarantined";
  reasonCode: EditorialReason;
};

type EntryRow = {
  id: string;
  word_key: string;
  part_of_speech: string;
  sense_key: string;
  revision: number;
  status: EditorialStatus;
  content: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  digest: string;
  created_at?: string;
  updated_at: string;
};

/** Explicit serialization: never return raw service-role query, credentials, or user events. */
function summary(row: EntryRow) {
  const c = row.content ?? {};
  return {
    id: row.id,
    word: row.word_key,
    partOfSpeech: row.part_of_speech,
    senseKey: row.sense_key,
    revision: row.revision,
    status: row.status,
    meanings: Array.isArray(c.meanings) ? c.meanings.filter(x => typeof x === "string").slice(0, 4) : [],
    cefr: typeof c.cefr === "string" ? c.cefr : "",
    digest: row.digest,
    updatedAt: row.updated_at,
  };
}

function assertAdmin(ctx: RequestContext, config: ServerConfig, injected?: SupabaseClient) {
  // Check authenticated server-side user UUID before creating an elevated client.
  assertAtlasAdmin(ctx, config);
  return injected ?? quotaClient(config);
}

/** Cursor-like bounded offset; never request or export the whole canonical corpus. */
export async function listEditorialEntries(
  ctx: RequestContext, config: ServerConfig, filters: EditorialListFilters, injected?: SupabaseClient,
) {
  const db = assertAdmin(ctx, config, injected);
  const { status, word, offset, limit } = filters;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 30 ||
      !["all", "machine_validated", "human_reviewed", "quarantined"].includes(status) ||
      (word !== "" && (!/^[a-z]+(?:[ '-][a-z]+)*$/.test(word) || word.length > 120))) {
    throw new HttpError(400, "Yönetim listesi filtresi geçersiz.", "ADMIN_FILTER_INVALID");
  }
  let query = db.from("atlas_lexicon_entries")
    .select("id,word_key,part_of_speech,sense_key,revision,status,content,digest,updated_at").neq("part_of_speech","Tooltip");
  if (status !== "all") query = query.eq("status", status);
  if (word) query = query.eq("word_key", word);
  const { data, error } = await query.order("updated_at", { ascending: false })
    .order("id", { ascending: true }).range(offset, offset + limit);
  databaseError(error);
  const rows = (data ?? []) as EntryRow[];
  const hasMore = rows.length > limit;
  return { entries: rows.slice(0, limit).map(summary), offset, limit,
    nextOffset: hasMore ? offset + limit : null, hasMore };
}

export async function readEditorialEntry(
  ctx: RequestContext, config: ServerConfig, id: string, injected?: SupabaseClient,
) {
  const db = assertAdmin(ctx, config, injected);
  const { data, error } = await db.from("atlas_lexicon_entries")
    .select("id,word_key,part_of_speech,sense_key,revision,status,content,provenance,digest,created_at,updated_at")
    .eq("id", id).maybeSingle();
  databaseError(error);
  if (!data) throw new HttpError(404, "Kelime kaydı bulunamadı.", "LEXICON_ENTRY_NOT_FOUND");
  const row = data as EntryRow;
  if(row.part_of_speech==="Tooltip")throw new HttpError(404,"Tam YDS kelime kaydı bulunamadı.","LEXICON_ENTRY_NOT_FOUND");
  // Ledger payload is bounded and explicitly projected; original content stays immutable in DB.
  const ledger = await db.from("atlas_lexicon_entry_revisions")
    .select("revision,status,action,actor_id,reason_code,digest,created_at")
    .eq("entry_id", id).order("revision", { ascending: false }).limit(21);
  databaseError(ledger.error);
  const revisions = (ledger.data ?? []) as Array<Record<string, unknown>>;
  const p = row.provenance ?? {};
  return {
    entry: { ...summary(row), content: row.content,
      createdAt: row.created_at,
      provenance: {provider: typeof p.provider === "string" ? p.provider : null,
        model: typeof p.model === "string" ? p.model : null,
        validation: typeof p.validation === "string" ? p.validation : null} },
    revisions: revisions.slice(0, 20).map(x => ({
      revision: x.revision, status: x.status, action: x.action,
      actorId: x.actor_id, reasonCode: x.reason_code, digest: x.digest, createdAt: x.created_at,
    })),
    hasOlderRevisions: revisions.length > 20,
  };
}

/** All admin writes go through the existing backend-only, revision-CAS RPC. */
export async function reviewEditorialEntry(
  ctx: RequestContext, config: ServerConfig, id: string, input: EditorialReview, injected?: SupabaseClient,
) {
  const db = assertAdmin(ctx, config, injected);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
      !["human_reviewed", "quarantined"].includes(input.nextStatus) ||
      !["editorial_approved", "incorrect_sense", "quality", "unsafe", "other"].includes(input.reasonCode) ||
      (input.nextStatus === "human_reviewed") !== (input.reasonCode === "editorial_approved")) {
    throw new HttpError(400, "Editoryal karar veya gerekçesi geçersiz.", "EDITORIAL_DECISION_INVALID");
  }
  const { data, error } = await db.from("atlas_lexicon_entries")
    .select("id,word_key,part_of_speech,sense_key,revision,status,content,digest,updated_at")
    .eq("id", id).maybeSingle();
  databaseError(error);
  if (!data) throw new HttpError(404, "Kelime kaydı bulunamadı.", "LEXICON_ENTRY_NOT_FOUND");
  const existing = data as EntryRow;
  if(existing.part_of_speech==="Tooltip")throw new HttpError(409,"Kısa tooltip kaydı YDS editoryal onayına uygun değil.","EDITORIAL_TRANSITION_BLOCKED");
  if (existing.revision !== input.expectedRevision) {
    throw new HttpError(409, "Kelime başka bir işlemle güncellendi; yeniden yükle.", "LEXICON_REVISION_CONFLICT");
  }
  if (existing.status === "quarantined" ||
      (existing.status === "human_reviewed" && input.nextStatus === "human_reviewed")) {
    throw new HttpError(409, "Bu kayıt için istenen geçişe izin verilmiyor.", "EDITORIAL_TRANSITION_BLOCKED");
  }
  if (input.nextStatus === "human_reviewed") {
    // Human review cannot approve corrupt, partial or wrong-POS/sense content.
    try {
      const c = existing.content;
      const calculated = lexicalIdentity(c.word as string, c.partOfSpeech as string,
        (c.meanings as string[])?.[0] ?? "");
      if (calculated.wordKey !== existing.word_key ||
          calculated.partOfSpeech !== existing.part_of_speech ||
          calculated.senseKey !== existing.sense_key ||
          !hasCompleteTierSet(c.examples as Parameters<typeof hasCompleteTierSet>[0])) {
        throw new Error("Lexical identity or tier distribution mismatch");
      }
      validateLexicalCandidate(c as Parameters<typeof validateLexicalCandidate>[0]);
    } catch {
      throw new HttpError(422, "Kayıt içerik ve anlam denetiminden geçmedi.", "EDITORIAL_CONTENT_INVALID");
    }
  }
  // Actor ID comes exclusively from authenticate(), never request JSON or a browser role.
  const result = await db.rpc("atlas_lexicon_review_v1", {
    p_entry_id: id,
    p_expected_revision: input.expectedRevision,
    p_next_status: input.nextStatus,
    p_actor_id: ctx.userId,
    p_reason_code: input.reasonCode,
  });
  if (result.error?.code === "40001") {
    throw new HttpError(409, "Revizyon eşzamanlı değişti; yeniden yükle.", "LEXICON_REVISION_CONFLICT");
  }
  if (result.error?.code === "P0002") {
    throw new HttpError(404, "Kelime kaydı bulunamadı.", "LEXICON_ENTRY_NOT_FOUND");
  }
  if (result.error?.code === "22023") {
    throw new HttpError(409, "Editoryal geçiş kabul edilmedi.", "EDITORIAL_TRANSITION_BLOCKED");
  }
  databaseError(result.error);
  if (!Array.isArray(result.data) || result.data.length !== 1) {
    throw new HttpError(503, "Editoryal karar doğrulanamadı.", "EDITORIAL_RESULT_INVALID");
  }
  const updated = result.data[0] as EntryRow;
  if (updated.id !== id || updated.revision !== existing.revision + 1 ||
      updated.status !== input.nextStatus || updated.digest !== existing.digest ||
      updated.word_key !== existing.word_key ||
      updated.part_of_speech !== existing.part_of_speech || updated.sense_key !== existing.sense_key) {
    throw new HttpError(503, "Editoryal kayıt tutarsızlığı tespit edildi.", "EDITORIAL_RESULT_INVALID");
  }
  return { entry: summary(updated), action: input.nextStatus === "human_reviewed" ? "approved" : "quarantined" };
}
