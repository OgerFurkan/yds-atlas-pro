import { describe, expect, test } from "bun:test";
import type { LeveledExample } from "@yds-atlas/shared";
import { createApp } from "../src/app";
import { readConfig } from "../src/config/env";
import { createClient } from "@supabase/supabase-js";
import { accountState } from "../src/features/learning/learning-service";
import { createHash } from "node:crypto";
import { inspectCachedLexicon, validateInspectorQuery, rejectInspectorDuringSavedAssessment } from "../src/features/lexicon/lexicon-inspector";
import type { LexicalContent, LexiconEntry, LexiconStore } from "../src/features/lexicon/lexicon-resolver";

const examples: LeveledExample[] = [
  { sentence: "They obtain new skills.", translation: "Yeni beceriler edinirler.", difficulty: "easy", translationFocus: ["edinirler"] },
  { sentence: "Students obtain useful feedback.", translation: "Öğrenciler yararlı geri bildirim elde eder.", difficulty: "easy", translationFocus: ["elde eder"] },
  { sentence: "Researchers obtain reliable results after careful experiments.", translation: "Araştırmacılar deneylerden sonra güvenilir sonuçlar elde eder.", difficulty: "medium", translationFocus: ["elde eder"] },
  { sentence: "Universities obtain substantial funding when their research produces measurable benefits for the wider scientific community.", translation: "Üniversiteler araştırmaları bilim topluluğuna yararlar sağladığında finansman elde eder.", difficulty: "yds", translationFocus: ["elde eder"] },
  { sentence: "Environmental agencies obtain more accurate estimates when monitoring systems collect consistent data throughout the entire year.", translation: "Çevre kurumları sistemleri yıl boyunca veri topladığında daha doğru tahminler elde eder.", difficulty: "yds", translationFocus: ["elde eder"] },
];
const content: LexicalContent = { word:"obtain",partOfSpeech:"Verb",meanings:["elde etmek"],alternatives:[],
  usageNote:"Academic writing",cefr:"B2",examples:examples.map(x=>({...x,translationFocus:[...(x.translationFocus ?? [])]})),
  pronunciationUk:"/əbˈteɪn/", pronunciationUs:"/əbˈteɪn/",sourceUrl:"https://private.example/internal"};
function entry(overrides: Partial<LexiconEntry> = {}): LexiconEntry {
  return { id:"11111111-1111-4111-8111-111111111111",wordKey:"obtain",partOfSpeech:"Verb",
    senseKey:createHash("sha256").update("elde etmek").digest("hex"),revision:4,
    status:"machine_validated",content:{...content},provenance:{prompt:"SECRET_PROMPT",apiKey:"SECRET_KEY"},...overrides };
}
function store(rows:LexiconEntry[]) {
  const calls:string[]=[];
  const client={
    async findCandidates(wordKey:string){calls.push(`find:${wordKey}`);return rows},
    async claim(){calls.push("claim");throw Error("no claim")},
    async publish(){calls.push("publish");throw Error("no publish")},
    async fail(){calls.push("fail");throw Error("no fail")},
  } as unknown as LexiconStore;
  return {client,calls};
}

describe("F4a Word Inspector cache-only boundary (no remote DB)",()=>{
  test("explicit cache hit has all five 2/1/2 examples and UK/US pronunciation",async()=>{
    const s=store([entry()]);const result=await inspectCachedLexicon({word:"obtain"},s.client);
    expect(result.status).toBe("ready");if(result.status!=="ready")return;
    expect(result.entry.examples.map(x=>x.difficulty)).toEqual(["easy","easy","medium","yds","yds"]);
    expect(result.entry.pronunciationUk).toBe("/əbˈteɪn/");expect(result.entry.pronunciationUs).toBe("/əbˈteɪn/");
    expect(s.calls).toEqual(["find:obtain"]);
  });
  test("cache miss never invokes generator, claim or quota",async()=>{
    const s=store([]);expect(await inspectCachedLexicon({word:"obtain"},s.client))
      .toEqual({status:"missing",word:"obtain"});expect(s.calls).toEqual(["find:obtain"]);
  });
  test("multiple meanings return metadata choices without example answers",async()=>{
    const meaning="kazanmak";const alternate=entry({id:"22222222-2222-4222-8222-222222222222",
      senseKey:createHash("sha256").update(meaning).digest("hex"),
      content:{...content,meanings:[meaning]}});
    const s=store([entry(),alternate]);const result=await inspectCachedLexicon({word:"obtain"},s.client);
    expect(result.status).toBe("choices");if(result.status!=="choices")return;
    expect(result.choices).toHaveLength(2);expect(JSON.stringify(result)).not.toContain("examples");
  });
  test("explicit POS + sense picks exact record, never arbitrary homograph",async()=>{
    const meaning="kazanmak";const alt=entry({id:"22222222-2222-4222-8222-222222222222",
      senseKey:createHash("sha256").update(meaning).digest("hex"),content:{...content,meanings:[meaning]}});
    const result=await inspectCachedLexicon({word:"obtain",partOfSpeech:"Verb",meaning},store([entry(),alt]).client);
    expect(result.status).toBe("ready");if(result.status!=="ready")return;
    expect(result.entry.meanings[0]).toBe(meaning);
  });
  test("absent sense must return missing, not wrong sense",async()=>{
    const result=await inspectCachedLexicon({word:"obtain",partOfSpeech:"Verb",meaning:"yanlış"},store([entry()]).client);
    expect(result.status).toBe("missing");
  });
  test("POS filter accepts matching part",async()=>{
    const result=await inspectCachedLexicon({word:"obtain",partOfSpeech:"Verb"},store([entry()]).client);
    expect(result.status).toBe("ready");
  });
  test("POS mismatch cannot select content",async()=>{
    const result=await inspectCachedLexicon({word:"obtain",partOfSpeech:"Noun"},store([entry()]).client);
    expect(result.status).toBe("missing");
  });
  test("reject invalid word before touching store",async()=>{
    const s=store([entry()]);await expect(inspectCachedLexicon({word:"../admin"},s.client))
      .rejects.toMatchObject({code:"INSPECTOR_INVALID_WORD"});expect(s.calls).toHaveLength(0);
  });
  test("reject invalid POS before touching store",async()=>{
    const s=store([entry()]);await expect(inspectCachedLexicon({word:"obtain",partOfSpeech:"Hacker"},s.client))
      .rejects.toMatchObject({code:"INSPECTOR_INVALID_POS"});expect(s.calls).toHaveLength(0);
  });
  test("reject meaning without POS before touching store",async()=>{
    const s=store([entry()]);await expect(inspectCachedLexicon({word:"obtain",meaning:"elde etmek"},s.client))
      .rejects.toMatchObject({code:"INSPECTOR_INVALID_SENSE"});expect(s.calls).toHaveLength(0);
  });
  test("quarantined row never exposed",async()=>{
    const result=await inspectCachedLexicon({word:"obtain"},store([entry({status:"quarantined"})]).client);
    expect(result.status).toBe("missing");
  });
  test("incomplete tier distribution never exposed",async()=>{
    const result=await inspectCachedLexicon({word:"obtain"},store([entry({content:{...content,examples:examples.slice(0,4)}})]).client);
    expect(result.status).toBe("missing");
  });
  test("mismatched sense identity never exposed",async()=>{
    const result=await inspectCachedLexicon({word:"obtain"},store([entry({senseKey:"e".repeat(64)})]).client);
    expect(result.status).toBe("missing");
  });
  test("invalid example fails machine validation",async()=>{
    const copy={...content,examples:examples.map(x=>({...x}))};copy.examples[0]={...copy.examples[0],sentence:"This sentence has no target headword."};
    const result=await inspectCachedLexicon({word:"obtain"},store([entry({content:copy})]).client);
    expect(result.status).toBe("missing");
  });
  test("only public projected fields, no provenance, prompt, API key or source URL",async()=>{
    const result=await inspectCachedLexicon({word:"obtain"},store([entry()]).client);
    expect(result.status).toBe("ready");const encoded=JSON.stringify(result);
    for(const secret of ["SECRET_PROMPT","SECRET_KEY","provenance","sourceUrl","private.example"])
      expect(encoded).not.toContain(secret);
  });
  test("optional missing translationFocus fails closed instead of crashing",async()=>{
    const row=entry({content:{...content,examples:content.examples.map((item,index)=>
      index===0?{...item,translationFocus:undefined}:item)}});
    const result=await inspectCachedLexicon({word:"obtain"},store([row]).client);
    expect(result.status).toBe("missing");
  });
  test("inspection copies nested public arrays without mutating shared pool",async()=>{
    const row=entry();const before=JSON.stringify(row);
    const result=await inspectCachedLexicon({word:"obtain"},store([row]).client);
    expect(result.status).toBe("ready");if(result.status!=="ready")return;
    result.entry.meanings[0]="tampered";
    result.entry.examples[0].translationFocus.push("tampered");
    expect(JSON.stringify(row)).toBe(before);
  });
  test("NFKC casing and whitespace normalize without changing meaning",()=>{
    expect(validateInspectorQuery({word:"  ＯＢＴＡＩＮ ",partOfSpeech:"Verb",meaning:"  elde   etmek  "}))
      .toEqual({word:"obtain",partOfSpeech:"Verb",meaning:"elde etmek"});
  });
  test("long word and oversized meaning rejected",()=>{
    expect(()=>validateInspectorQuery({word:"x".repeat(121)})).toThrow();
    expect(()=>validateInspectorQuery({word:"obtain",partOfSpeech:"Verb",meaning:"x".repeat(201)})).toThrow();
  });
  test("search leaves canonical store entirely unchanged",async()=>{
    const item=entry(),before=JSON.stringify(item);const s=store([item]);
    await inspectCachedLexicon({word:"obtain"},s.client);
    expect(JSON.stringify(item)).toBe(before);expect(s.calls).toEqual(["find:obtain"]);
  });
});


describe("Feedback staging: server-side saved-assessment Inspector gate",()=>{
  const ctx = (data: unknown, error: unknown = null) => ({
    userId: "alice",
    db: { from(table: string) {
      expect(table).toBe("learning_sessions");
      return { select(columns: string) {
        expect(columns).toBe("id");
        return { eq(field: string, owner: string) {
          expect([field, owner]).toEqual(["user_id", "alice"]);
          return { is(column: string, value: unknown) {
            expect([column, value]).toEqual(["completed_at", null]);
            return { limit(n: number) {
              expect(n).toBe(1);
              return Promise.resolve({data, error});
            }};
          }};
        }};
      }};
    }}
  }) as never;
  test("uncompleted cloud game blocks Inspector even if the UI route is bypassed",async()=>{
    await expect(rejectInspectorDuringSavedAssessment(ctx([{id:"game-session"}])))
      .rejects.toMatchObject({status:409,code:"INSPECTOR_ACTIVE_ASSESSMENT"});
  });
  test("all Feedback learning aids deny an unfinished game regardless of age", async () => {
    const app = createApp(readConfig({ATLAS_FEEDBACK_LEXICON_ENABLED:"true"}), {
      authenticate: async () => ctx([{id:"old-unfinished"}]),
    });
    for (const [method,path] of [
      ["GET","lexicon/inspect"], ["GET","dictionary/turkish"], ["GET","lexicon/candidates"],
      ["POST","lexicon/resolve"], ["POST","lexicon/complete"], ["POST","lexicon/suggest"],
      ["POST","ai/chat"], ["POST","ai/words/enrich"], ["POST","ai/words/complete"], ["POST","ai/words/suggest"],
    ]) {
      const response = await app(new Request("http://localhost/api/" + path, {method}));
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("INSPECTOR_ACTIVE_ASSESSMENT");
    }
  });
  test("account restore prioritizes the same user's unfinished games before completed history", async () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    const requests: URL[] = [];
    const db = createClient("http://127.0.0.1:1", "fixture", {
      auth: {persistSession:false, autoRefreshToken:false},
      global: {fetch: Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        requests.push(url);
        if (url.pathname.endsWith("/profiles") && init?.method === "GET")
          return Response.json({daily_goal:20});
        return Response.json([]);
      }, {preconnect: () => {}})},
    });
    const state = await accountState({userId:owner, db});
    const query = requests.find(url => url.pathname.endsWith("/learning_sessions"))!.searchParams;
    expect(query.get("user_id")).toBe("eq." + owner);
    expect(query.get("order")).toBe("completed_at.desc.nullsfirst,updated_at.desc");
    expect(query.get("limit")).toBe("1");
    expect(state.session).toBeNull();
  });
  test("no unfinished session allows cache-only Inspector lookup",async()=>{
    await expect(rejectInspectorDuringSavedAssessment(ctx([]))).resolves.toBeUndefined();
  });
  test("null result fails closed rather than leaking inspector hints",async()=>{
    await expect(rejectInspectorDuringSavedAssessment(ctx(null)))
      .rejects.toMatchObject({status:503,code:"INSPECTOR_SESSION_UNAVAILABLE"});
  });
  test("database permission errors fail closed",async()=>{
    await expect(rejectInspectorDuringSavedAssessment(ctx(null,{code:"42501",message:"denied"})))
      .rejects.toBeDefined();
  });
});
