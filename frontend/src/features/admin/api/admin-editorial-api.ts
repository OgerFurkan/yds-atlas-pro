import { z } from "zod";
import { apiRequest } from "@/shared/api/api-client";

export const editorialStatusSchema = z.enum(["machine_validated", "human_reviewed", "quarantined"]);
export type EditorialStatus = z.infer<typeof editorialStatusSchema>;
export type EditorialFilterStatus = EditorialStatus | "all";
export type EditorialReason = "incorrect_sense" | "quality" | "unsafe" | "other";

const summarySchema = z.object({
  id: z.uuid(),
  word: z.string().max(120),
  partOfSpeech: z.string().max(32),
  senseKey: z.string().max(250),
  revision: z.number().int().min(1),
  status: editorialStatusSchema,
  meanings: z.array(z.string().max(250)).max(4),
  cefr: z.string().max(32),
  digest: z.string(),
  updatedAt: z.string(),
});
export type EditorialSummary = z.infer<typeof summarySchema>;

const exampleSchema = z.object({
  sentence: z.string(),
  translation: z.string(),
  difficulty: z.enum(["easy", "medium", "yds"]).optional(),
  translationFocus: z.array(z.string()).optional(),
});

const detailSchema = z.object({
  entry: summarySchema.extend({
    createdAt: z.string().optional(),
    content: z.object({
      usageNote: z.string().optional(),
      word: z.string().optional(),
      examples: z.array(exampleSchema).optional(),
    }).passthrough(),
    provenance: z.object({
      provider: z.string().nullable(),
      model: z.string().nullable(),
      validation: z.string().nullable(),
    }),
  }),
  revisions: z.array(z.object({
    revision: z.number().int().min(1),
    status: z.string(),
    action: z.string(),
    actorId: z.string().nullable().optional(),
    reasonCode: z.string().nullable().optional(),
    digest: z.string(),
    createdAt: z.string(),
  })).max(20),
  hasOlderRevisions: z.boolean(),
});
export type EditorialDetail = z.infer<typeof detailSchema>;

const listSchema = z.object({
  entries: z.array(summarySchema).max(30),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(30),
  hasMore: z.boolean(),
  nextOffset: z.number().int().min(0).nullable(),
});
export type EditorialList = z.infer<typeof listSchema>;
export type EditorialFilters = { status: EditorialFilterStatus; word: string; offset: number; limit: 20 };

export function editorialListPath(filters: EditorialFilters): string {
  if (!(["all", "machine_validated", "human_reviewed", "quarantined"] as string[]).includes(filters.status) ||
      !Number.isSafeInteger(filters.offset) || filters.offset < 0 || filters.offset > 5000 ||
      filters.limit !== 20 || filters.word.length > 120 ||
      (filters.word !== "" && !/^[a-z]+(?:[ '-][a-z]+)*$/.test(filters.word))) {
    throw new Error("Editoryal filtre geçersiz.");
  }
  const query = new URLSearchParams({
    status: filters.status, word: filters.word,
    offset: String(filters.offset), limit: String(filters.limit),
  });
  return `/api/admin/lexicon?${query.toString()}`;
}

export async function listEditorial(filters: EditorialFilters, owner: string, signal?: AbortSignal) {
  return listSchema.parse(await apiRequest<unknown>(editorialListPath(filters), { signal }, owner));
}
export async function getEditorial(id: string, owner: string, signal?: AbortSignal) {
  const safeId = z.uuid().parse(id);
  return detailSchema.parse(await apiRequest<unknown>(`/api/admin/lexicon/${safeId}`, { signal }, owner));
}
export async function reviewEditorial(
  id: string, expectedRevision: number,
  decision: { nextStatus: "human_reviewed"; reasonCode: "editorial_approved" } |
    { nextStatus: "quarantined"; reasonCode: EditorialReason },
  owner: string,
) {
  const safeId = z.uuid().parse(id);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new Error("Revizyon geçersiz.");
  const result = await apiRequest<unknown>(`/api/admin/lexicon/${safeId}/review`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision, ...decision }),
  }, owner);
  return z.object({ entry: summarySchema, action: z.enum(["approved", "quarantined"]) }).parse(result);
}
