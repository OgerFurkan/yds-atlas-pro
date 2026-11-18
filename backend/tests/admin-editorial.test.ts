import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listEditorialEntries, readEditorialEntry, reviewEditorialEntry } from "../src/features/admin/admin-editorial-service";
import { tryEditorialAdminRoute } from "../src/features/admin/admin-editorial-routes";
import type { RequestContext } from "../src/shared/supabase";
import type { ServerConfig } from "../src/config/env";

const adminId = "11111111-1111-4111-8111-111111111111";
const nonAdminId = "22222222-2222-4222-8222-222222222222";
const entryId = "33333333-3333-4333-8333-333333333333";
const senseKey = createHash("sha256").update("elde etmek").digest("hex");
const examples = [
  { sentence: "They obtain new skills.", translation: "Yeni beceriler edinirler.", translationFocus: ["edinirler"], difficulty: "easy" },
  { sentence: "Students obtain useful feedback.", translation: "Öğrenciler yararlı geri bildirim elde eder.", translationFocus: ["elde eder"], difficulty: "easy" },
  { sentence: "Researchers obtain reliable results after careful experiments.", translation: "Araştırmacılar deneylerden sonra güvenilir sonuçlar elde eder.", translationFocus: ["elde eder"], difficulty: "medium" },
  { sentence: "Universities obtain substantial funding when their research produces measurable benefits for the wider scientific community.", translation: "Üniversiteler araştırmaları bilim topluluğuna yararlar sağladığında finansman elde eder.", translationFocus: ["elde eder"], difficulty: "yds" },
  { sentence: "Environmental agencies obtain more accurate estimates when monitoring systems collect consistent data throughout the entire year.", translation: "Çevre kurumları sistemleri yıl boyunca veri topladığında daha doğru tahminler elde eder.", translationFocus: ["elde eder"], difficulty: "yds" },
];
const content = { word: "obtain", partOfSpeech: "Verb", meanings: ["elde etmek"],
  alternatives: [], usageNote: "Academic writing", cefr: "B2", examples };
type MockRow = {
  id: string; word_key: string; part_of_speech: string; sense_key: string;
  revision: number; status: string; content: Record<string, unknown>; digest: string;
  updated_at: string; created_at?: string; provenance?: Record<string, unknown>;
};
const baseRow: MockRow = { id: entryId, word_key: "obtain", part_of_speech: "Verb", sense_key: senseKey,
  revision: 3, status: "machine_validated", content, digest: "a".repeat(64),
  updated_at: "2026-11-17T10:00:00Z", created_at: "2026-11-17T09:00:00Z",
  provenance: { provider: "Gemini", model: "gemini-test", prompt: "NEVER_EXPOSE" } };
const config = { ATLAS_ADMIN_USER_ID: adminId } as ServerConfig;
const ctx = (id = adminId) => ({ userId: id, db: null } as unknown as RequestContext);

type MockOptions = { row?: MockRow | null; rows?: MockRow[]; revisions?: Array<Record<string, unknown>>;
  rpcError?: { code: string }; rpcData?: unknown };
function mockDb(opt: MockOptions = {}) {
  const calls: Array<{ kind: string; name?: string; args?: Record<string, unknown> }> = [];
  const row = opt.row === undefined ? baseRow : opt.row;
  const rows = opt.rows ?? (row ? [row] : []);
  const revisions = opt.revisions ?? [{ revision: 3, status: "machine_validated", action: "generated", actor_id: null,
    reason_code: null, digest: baseRow.digest, created_at: "2026-11-17T09:00:00Z" }];
  function query(table: string) {
    const filters: Record<string, unknown> = {};
    const chain = {
      select(columns: string) { calls.push({ kind: "select", name: table, args: { columns } }); return this; },
      eq(key: string, value: unknown) { filters[key] = value; return this; },
      neq(key: string, value: unknown) { filters["!"+key] = value; return this; },
      order(_key: string, _options: unknown) { return this; },
      range(from: number, to: number) {
        calls.push({kind: "range", name: table, args: { from, to }});
        const matched = rows.filter(x => (!filters.status || x.status === filters.status) &&
          (!filters.word_key || x.word_key === filters.word_key) &&
          (!filters["!part_of_speech"] || x.part_of_speech !== filters["!part_of_speech"]));
        return Promise.resolve({data: matched.slice(from, to + 1), error: null});
      },
      maybeSingle() { calls.push({kind: "maybeSingle", name: table}); return Promise.resolve({data: row, error: null}); },
      limit(n: number) { calls.push({kind: "limit", name: table, args: {n}});
        return Promise.resolve({data: revisions.slice(0, n), error: null}); },
    };
    return chain;
  }
  const client = {
    from(table: string) { calls.push({kind: "from", name: table}); return query(table); },
    rpc(name: string, args: Record<string, unknown>) { calls.push({kind: "rpc", name, args});
      return Promise.resolve({error: opt.rpcError ?? null, data: opt.rpcData ?? [{...baseRow,
        revision: Number(args.p_expected_revision) + 1, status: args.p_next_status}]}); },
  } as unknown as SupabaseClient;
  return {client, calls};
}

describe("F3 Feedback Admin Editorial (no remote DB)", () => {
  test("unauthorized list is rejected before service_role access", async () => {
    const s = mockDb();
    await expect(listEditorialEntries(ctx(nonAdminId), config, {status:"all",word:"",offset:0,limit:10},s.client))
      .rejects.toMatchObject({code:"ADMIN_FORBIDDEN"});
    expect(s.calls).toHaveLength(0);
  });
  test("unauthorized review never queries or calls RPC", async () => {
    const s = mockDb();
    await expect(reviewEditorialEntry(ctx(nonAdminId),config,entryId,
      {expectedRevision:3,nextStatus:"human_reviewed",reasonCode:"editorial_approved"},s.client))
      .rejects.toMatchObject({code:"ADMIN_FORBIDDEN"});
    expect(s.calls).toHaveLength(0);
  });
  test("listing caps page size and excludes provenance", async () => {
    const s = mockDb({rows: Array.from({length:3},()=>baseRow)});
    const result = await listEditorialEntries(ctx(),config,{status:"all",word:"",offset:0,limit:2},s.client);
    expect(result.entries).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(2);
    expect(JSON.stringify(result)).not.toContain("NEVER_EXPOSE");
    expect(s.calls.find(c=>c.kind==="range")?.args).toEqual({from:0,to:2});
  });
  test("admin list filters exact headword, rejects excessive pagination", async () => {
    const s = mockDb();
    const result = await listEditorialEntries(ctx(),config,{status:"machine_validated",word:"obtain",offset:0,limit:2},s.client);
    expect(result.entries[0]?.word).toBe("obtain");
    await expect(listEditorialEntries(ctx(),config,{status:"all",word:"",offset:0,limit:31},s.client))
      .rejects.toMatchObject({code:"ADMIN_FILTER_INVALID"});
  });
  test("tooltip-only shared glossary never enters YDS editorial list or review", async () => {
    const tooltip = {...baseRow, id: "44444444-4444-4444-8444-444444444444",
      word_key:"climate", part_of_speech:"Tooltip", content:{kind:"atlas_tooltip_gloss_v1",
        meanings:["iklim"],examples:[]}};
    const s = mockDb({row:tooltip,rows:[tooltip,baseRow]});
    const result = await listEditorialEntries(ctx(),config,{status:"all",word:"",offset:0,limit:10},s.client);
    expect(result.entries.map(x=>x.word)).toEqual(["obtain"]);
    await expect(readEditorialEntry(ctx(),config,tooltip.id,s.client))
      .rejects.toMatchObject({code:"LEXICON_ENTRY_NOT_FOUND"});
    await expect(reviewEditorialEntry(ctx(),config,tooltip.id,
      {expectedRevision:3,nextStatus:"human_reviewed",reasonCode:"editorial_approved"},s.client))
      .rejects.toMatchObject({code:"EDITORIAL_TRANSITION_BLOCKED"});
    expect(s.calls.some(x=>x.kind==="rpc")).toBe(false);
  });
  test("revision detail is capped and redacts raw provenance", async () => {
    const s = mockDb({revisions:Array.from({length:21},(_,i)=>({revision:21-i,action:"generated",status:"machine_validated"}))});
    const result = await readEditorialEntry(ctx(),config,entryId,s.client);
    expect(result.revisions).toHaveLength(20);
    expect(result.hasOlderRevisions).toBe(true);
    expect(JSON.stringify(result)).not.toContain("NEVER_EXPOSE");
  });
  test("approved transition uses exactly one service-only RPC and verified user UUID", async () => {
    const s = mockDb();
    const out = await reviewEditorialEntry(ctx(),config,entryId,
      {expectedRevision:3,nextStatus:"human_reviewed",reasonCode:"editorial_approved"},s.client);
    expect(out.action).toBe("approved");
    expect(out.entry.revision).toBe(4);
    const writes = s.calls.filter(c=>c.kind==="rpc");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({kind:"rpc",name:"atlas_lexicon_review_v1",args:{
      p_entry_id:entryId,p_expected_revision:3,p_next_status:"human_reviewed",
      p_actor_id:adminId,p_reason_code:"editorial_approved"}});
    expect(s.calls.some(c=>c.kind==="update" || c.kind==="insert")).toBe(false);
  });
  test("revision mismatch rejected without RPC", async () => {
    const s=mockDb();
    await expect(reviewEditorialEntry(ctx(),config,entryId,
      {expectedRevision:2,nextStatus:"human_reviewed",reasonCode:"editorial_approved"},s.client))
      .rejects.toMatchObject({code:"LEXICON_REVISION_CONFLICT"});
    expect(s.calls.some(c=>c.kind==="rpc")).toBe(false);
  });
  test("concurrent stale RPC 40001 maps to conflict", async () => {
    const s=mockDb({rpcError:{code:"40001"}});
    await expect(reviewEditorialEntry(ctx(),config,entryId,
      {expectedRevision:3,nextStatus:"human_reviewed",reasonCode:"editorial_approved"},s.client))
      .rejects.toMatchObject({code:"LEXICON_REVISION_CONFLICT"});
  });
  test("wrong sense cannot be approved", async () => {
    const s=mockDb({row:{...baseRow,sense_key:"b".repeat(64)}});
    await expect(reviewEditorialEntry(ctx(),config,entryId,
      {expectedRevision:3,nextStatus:"human_reviewed",reasonCode:"editorial_approved"},s.client))
      .rejects.toMatchObject({code:"EDITORIAL_CONTENT_INVALID"});
    expect(s.calls.some(c=>c.kind==="rpc")).toBe(false);
  });
  test("incomplete 2/1/2 examples cannot be approved", async () => {
    const s=mockDb({row:{...baseRow, content:{...content,examples:[...examples.slice(0,4)]}}});
    await expect(reviewEditorialEntry(ctx(),config,entryId,
      {expectedRevision:3,nextStatus:"human_reviewed",reasonCode:"editorial_approved"},s.client))
      .rejects.toMatchObject({code:"EDITORIAL_CONTENT_INVALID"});
    expect(s.calls.some(c=>c.kind==="rpc")).toBe(false);
  });
  test("bad content may be quarantined for safety", async () => {
    const s=mockDb({row:{...baseRow, content:{...content,examples:[]}}});
    const out=await reviewEditorialEntry(ctx(),config,entryId,
      {expectedRevision:3,nextStatus:"quarantined",reasonCode:"quality"},s.client);
    expect(out.action).toBe("quarantined");
  });
  test("quarantined record cannot be approved via v1 RPC", async () => {
    const s=mockDb({row:{...baseRow,status:"quarantined"}});
    await expect(reviewEditorialEntry(ctx(),config,entryId,
      {expectedRevision:3,nextStatus:"human_reviewed",reasonCode:"editorial_approved"},s.client))
      .rejects.toMatchObject({code:"EDITORIAL_TRANSITION_BLOCKED"});
    expect(s.calls.some(c=>c.kind==="rpc")).toBe(false);
  });
  test("wrong reason and wrong RPC response fail closed", async () => {
    const s=mockDb();
    await expect(reviewEditorialEntry(ctx(),config,entryId,
      {expectedRevision:3,nextStatus:"human_reviewed",reasonCode:"quality"},s.client))
      .rejects.toMatchObject({code:"EDITORIAL_DECISION_INVALID"});
    const other=mockDb({rpcData:[{...baseRow,id:nonAdminId,revision:4,status:"human_reviewed"}]});
    await expect(reviewEditorialEntry(ctx(),config,entryId,
      {expectedRevision:3,nextStatus:"human_reviewed",reasonCode:"editorial_approved"},other.client))
      .rejects.toMatchObject({code:"EDITORIAL_RESULT_INVALID"});
  });
  test("admin route ignores all unrelated paths", async () => {
    const req=new Request("https://example.test/api/words",{method:"GET"});
    const result=await tryEditorialAdminRoute(req,ctx(nonAdminId),config);
    expect(result.handled).toBe(false);
  });
  test("admin route denies unauthorized before parsing malformed JSON", async () => {
    const req=new Request(`https://example.test/api/admin/lexicon/${entryId}/review`,{
      method:"POST",headers:{"content-type":"application/json"},body:"{broken"});
    await expect(tryEditorialAdminRoute(req,ctx(nonAdminId),config)).rejects.toMatchObject({code:"ADMIN_FORBIDDEN"});
  });
  test("admin route refuses invalid filters and extra fields", async () => {
    const req=new Request("https://example.test/api/admin/lexicon?status=all&status=quarantined");
    await expect(tryEditorialAdminRoute(req,ctx(),config)).rejects.toMatchObject({code:"ADMIN_FILTER_INVALID"});
    const req2=new Request(`https://example.test/api/admin/lexicon/${entryId}/review`,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        expectedRevision:3,nextStatus:"human_reviewed",reasonCode:"editorial_approved",actorId:nonAdminId})});
    await expect(tryEditorialAdminRoute(req2,ctx(),config)).rejects.toThrow();
  });
});
