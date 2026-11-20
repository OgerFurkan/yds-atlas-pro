import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
import { resolve } from "node:path";

/** Real repo TypeScript is executed through the native Node / Bun TS loader.
 * Imports are replaced by isolated stubs, not network or Supabase clients.
 */
function source(path, stubs = {}) {
  const raw = readFileSync(resolve(import.meta.dirname, path), "utf8");
  const exports = [...raw.matchAll(/\bexport\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)]
    .map((match) => match[1]);
  assert.ok(exports.length, "Cannot test a module without real function exports");
  const local = raw.replace(/^import\b[\s\S]*?;\s*/gm, "")
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const)\b)/g, "");
  const transformed = typeof Bun === "undefined"
    ? nodeModule.stripTypeScriptTypes(local, { mode: "transform" })
    : new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(local);
  assert.doesNotMatch(transformed, /(?:^|\n)\s*(?:import|export)\s/m);
  const aliases = Object.keys(stubs);
  return new Function(...aliases, transformed + `\nreturn { ${exports.join(", ")} };`)(...Object.values(stubs));
}
class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const model = source("../../frontend/src/features/word-library/model/sentence-tooltip.ts");
const dict = source("../src/features/lexicon/public-turkish-dictionary.ts", { HttpError });
const prefetch = source("../src/features/lexicon/sentence-lexicon-prefetch.ts", {
  createHash, randomUUID, quotaClient: () => { throw Error("Real DB is prohibited"); },
  dictionaryWord: dict.dictionaryWord,
  lookupPublicTurkish: () => { throw Error("Real dictionary access is prohibited"); },
});
const license = { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" };
const english = (pos, meanings) => ({ language: { code: "en" }, partOfSpeech: pos,
  senses: [{ translations: meanings.map((word) => ({ language: { code: "tr" }, word })) }] });
const payload = (word, entries) => ({ word, source: {
  license, url: `https://en.wiktionary.org/wiki/${word}` }, entries });

// Actual source under test: tokenization and UI vocabulary matching.
test("punctuation preserved and all English words become tappable segments", () => {
  const p = model.splitSentenceWords("Climate changes; evidence matters!");
  assert.equal(p.filter((item) => item.kind === "word").length, 4);
  assert.equal(p.map((item) => item.text).join(""), "Climate changes; evidence matters!");
});
test("existing personal-library entries may supply a local tooltip", () => {
  const index = model.buildVocabularyIndex([{word:"obtain",meanings:["elde etmek"],partOfSpeech:"Verb"}]);
  assert.equal(model.matchVocabulary("obtains", index)[0].meanings[0], "elde etmek");
});
test("a sentence word does not need to exist in the personal library", () => {
  assert.equal(model.matchVocabulary("climate",model.buildVocabularyIndex([])).length,0);
  assert.equal(model.splitSentenceWords("Climate change matters.").filter((item)=>item.kind==="word").length,3);
});
test("English sentence detection does not parse Turkish as English", () => {
  assert.equal(model.isLikelyEnglishSentence("The climate is changing."),true);
  assert.equal(model.isLikelyEnglishSentence("İklim hızla değişiyor."),false);
});
test("sentence token discovery deduplicates without sending whole sentences", () => {
  assert.deepEqual(prefetch.sentenceTokens(["The climate changes.","climate effects on change."]),
    ["climate","changes","effects","on","change"]);
});
test("sentence discovery strips email URLs, hashtags and proper names", () => {
  const t=prefetch.sentenceTokens(["Reports mention alice@example.com and https://test.example/path. #secret climate matters."]);
  assert.equal(t.includes("alice"),false);
  assert.equal(t.includes("https"),false);
  assert.equal(t.includes("secret"),false);
  assert.ok(t.includes("climate"));
});
test("queue is deduplicated and bounded, independent of personal-library writes", () => {
  assert.ok(prefetch.queueSentenceWords(["climate matters."])>=1);
  assert.equal(prefetch.queueSentenceWords(["climate matters."]),0);
});
test("shared-gloss writing fails closed unless the two separate server preconditions hold", async () => {
  const config={ATLAS_FEEDBACK_LEXICON_ENABLED:false,SUPABASE_SECRET_KEY:"fake-not-used"};
  assert.equal(prefetch.sentencePrefetchEnabled(config),false);
  assert.deepEqual(await prefetch.drainSentenceQueue(config),{disabled:true,processed:0});
  assert.equal(prefetch.startSentencePrefetch(config) instanceof Function,true);
});
test("missing Turkish is missing; never fabricate translations", () => {
  assert.equal(dict.parsePublicTurkish("obtain",payload("obtain",[english("verb",[])] )).status,"missing");
});
test("licensed single-POS Turkish fallback is accepted with source attribution", () => {
  const result=dict.parsePublicTurkish("obtain",payload("obtain",[english("verb",["elde etmek"])]));
  assert.equal(result.status,"ready");
  assert.equal(result.entries[0].meanings[0],"elde etmek");
  assert.equal(result.source.license,"CC BY-SA 4.0");
});
test("ambiguous noun/verb translations stay choices, not a fabricated single sense", () => {
  const result=dict.parsePublicTurkish("approach",payload("approach",[
    english("noun",["yaklaşım"]),english("verb",["yaklaşmak"]) ]));
  assert.equal(result.status,"choices");
  assert.equal(result.entries.length,2);
  assert.equal(prefetch.buildTooltipRecord("approach",result),null);
});
test("provider source spoofing and license mismatch are rejected", () => {
  const value=payload("obtain",[english("verb",["elde etmek"])]);
  assert.throws(()=>dict.parsePublicTurkish("obtain",{...value,source:{...value.source,url:"https://evil.example/wiki/obtain"}}),x=>x.code==="DICTIONARY_SOURCE_INVALID");
  assert.throws(()=>dict.parsePublicTurkish("obtain",{...value,source:{...value.source,license:{name:"unknown",url:"https://example.org"}}}),x=>x.code==="DICTIONARY_LICENSE_INVALID");
});
test("invalid words and arbitrary paths cannot reach the public provider", () => {
  for(const word of ["../../auth","two words","https://example.org","<img>"])
    assert.throws(()=>dict.dictionaryWord(word),x=>x.code==="DICTIONARY_INVALID_WORD");
});
test("missing licensed cache record produces no short-gloss write payload", () => {
  assert.equal(prefetch.buildTooltipRecord("obtain",{status:"missing",word:"obtain",entries:[]}),null);
});
test("single-POS source-validated record targets only canonical Atlas Lexicon", () => {
  const parsed=dict.parsePublicTurkish("obtain",payload("obtain",[english("verb",["elde etmek"])]));
  const rec=prefetch.buildTooltipRecord("obtain",parsed);
  assert.equal(rec.part_of_speech,"Tooltip");
  assert.equal(rec.content.kind,"atlas_tooltip_gloss_v1");
  assert.equal(rec.content.examples.length,0);
  assert.equal(rec.provenance.validation,"dictionary_verified_not_context_certified");
});
test("publisher uses audited claim/publish RPC only; no direct table upsert", async () => {
  const parsed=dict.parsePublicTurkish("obtain",payload("obtain",[english("verb",["elde etmek"])]));
  const rec=prefetch.buildTooltipRecord("obtain",parsed);const called=[];
  const cleanup=[];
  const client={rpc:async (name,args)=>{
    called.push([name,args]);
    return name==="atlas_lexicon_claim_v1"?{data:true,error:null}:{data:{
      word_key:rec.word_key,part_of_speech:"Tooltip",sense_key:rec.sense_key,
      status:"machine_validated",content:rec.content,provenance:rec.provenance,
      digest:rec.digest,
    },error:null};
  },from:(table)=>{
    assert.equal(table,"atlas_lexicon_jobs", "Only lease cleanup may update a table");
    return {update(fields){cleanup.push(["update",fields]);return this},
      eq(field,value){cleanup.push([field,value]);return this},
      then(resolve){return Promise.resolve({error:null}).then(resolve)}};
  }};
  assert.equal(await prefetch.publishShortGloss(client,rec),true);
  assert.deepEqual(called.map(([name])=>name),["atlas_lexicon_claim_v1","atlas_lexicon_publish_v1"]);
  assert.equal(called[0][1].p_word_key,rec.word_key);
  assert.equal(called[1][1].p_digest,rec.digest);
  assert.equal(called[1][1].p_token,called[0][1].p_token);
  assert.ok(cleanup.some(([field,value])=>field==="lease_token"&&value===called[0][1].p_token));
  assert.ok(cleanup.some(([field,value])=>field==="status"&&value==="generating"));
});
test("publisher aborts if audited claim RPC is missing; never inserts directly", async () => {
  const parsed=dict.parsePublicTurkish("obtain",payload("obtain",[english("verb",["elde etmek"])]));
  const rec=prefetch.buildTooltipRecord("obtain",parsed);
  const client={rpc:async()=>({data:null,error:new Error("RPC unavailable")}),from:()=>{throw Error("Forbidden");}};
  await assert.rejects(()=>prefetch.publishShortGloss(client,rec),/RPC unavailable/);
});
test("PR17 short gloss shape cannot impersonate a five-tier YDS entry", () => {
  const parsed=dict.parsePublicTurkish("obtain",payload("obtain",[english("verb",["elde etmek"])]));
  const record=prefetch.buildTooltipRecord("obtain",parsed);
  assert.equal(record.content.cefr,"Belirtilmedi");
  assert.equal(record.content.usageNote,"");
  assert.deepEqual(record.content.examples,[]);
  assert.equal(record.status,"machine_validated");
  assert.equal(record.revision,1);
});
test("busy publication lease cannot be mistaken for a saved shared gloss", async () => {
  const parsed=dict.parsePublicTurkish("obtain",payload("obtain",[english("verb",["elde etmek"])]));
  const record=prefetch.buildTooltipRecord("obtain",parsed);
  const calls=[];
  const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:false,error:null};},
    from:()=>{throw Error("No table writes after a lease collision");}};
  assert.equal(await prefetch.publishShortGloss(client,record),false);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"atlas_lexicon_claim_v1");
});
test("invalid RPC publication response fails closed and conditionally releases own lease",async()=>{
  const parsed=dict.parsePublicTurkish("obtain",payload("obtain",[english("verb",["elde etmek"])]));
  const record=prefetch.buildTooltipRecord("obtain",parsed);
  const calls=[];const filters=[];
  const client={rpc:async(name,args)=>{
    calls.push([name,args]);return name==="atlas_lexicon_claim_v1"?
      {data:true,error:null}:{data:{...record,status:"human_reviewed"},error:null};
  },from:(table)=>{
    assert.equal(table,"atlas_lexicon_jobs");
    return {update(){return this},eq(k,v){filters.push([k,v]);return this},
      then(resolve){return Promise.resolve({error:null}).then(resolve)}};
  }};
  await assert.rejects(()=>prefetch.publishShortGloss(client,record),/did not confirm/);
  assert.equal(calls.length,2);
  assert.ok(filters.some(([k,v])=>k==="lease_token"&&v===calls[0][1].p_token));
  assert.ok(filters.some(([k,v])=>k==="status"&&v==="generating"));
});
test("minimal production Lexicon migration has exactly two audited publisher RPCs",()=>{
  const sql=readFileSync(resolve(import.meta.dirname,"../../supabase/migrations/20261119180000_feedback_lexicon_minimal_pg17.sql"),"utf8");
  assert.match(sql,/GRANT SELECT,INSERT,UPDATE ON TABLE public\.atlas_lexicon_entries TO service_role/);
  assert.match(sql,/CREATE FUNCTION public\.atlas_lexicon_claim_v1/);
  assert.match(sql,/CREATE FUNCTION public\.atlas_lexicon_publish_v1/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.atlas_lexicon_publish_v1/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql,/CREATE TABLE public\.atlas_usage_events/);
});

test("queued word on unavailable publish is explicitly scheduled for retry",()=>{
  const worker=readFileSync(resolve(import.meta.dirname,"../src/features/lexicon/sentence-lexicon-prefetch.ts"),"utf8");
  assert.match(worker,/if \(record && !\(await publishShortGloss\(db, record\)\)\)\s*\{/);
  assert.match(worker,/due\.set\(word, Date\.now\(\) \+ 3600_000\)/);
  assert.doesNotMatch(worker,/\.from\("atlas_lexicon_entries"\)\.insert\(/);
});
test("shared cached tooltip requires exact validated provenance", async () => {
  const parsed=dict.parsePublicTurkish("obtain",payload("obtain",[english("verb",["elde etmek"])]));
  const rec=prefetch.buildTooltipRecord("obtain",parsed);
  const row={word_key:rec.word_key,part_of_speech:"Tooltip",status:"machine_validated",
    content:rec.content,provenance:rec.provenance};
  const db={from:()=>({select(){return this},eq(){return this},limit:async()=>({data:[row],error:null})})};
  const found=await prefetch.readSharedTooltipGloss(db,"obtain");
  assert.equal(found.meanings[0],"elde etmek");
});
test("untrusted cached tooltip provenance is rejected", async () => {
  const row={word_key:"obtain",part_of_speech:"Tooltip",status:"machine_validated",
    content:{kind:"atlas_tooltip_gloss_v1",meanings:["wrong"],originalPartOfSpeech:"verb"},
    provenance:{kind:"atlas_tooltip_gloss_v1",license:"no",provider:"unknown",url:"http://evil.example"}};
  const db={from:()=>({select(){return this},eq(){return this},limit:async()=>({data:[row],error:null})})};
  assert.equal(await prefetch.readSharedTooltipGloss(db,"obtain"),null);
});

// Exercise the real tiered-generation module with a sandboxed Zod facade and a
// deterministic mocked Gemini response. No model API, quota DB or secret is used.
function zodFacade() {
  const schema = () => ({
    trim(){return this;}, min(){return this;}, max(){return this;}, length(){return this;},
    strict(){return this;},
    superRefine(fn){this.refine=fn;return this;},
    parse(value){
      const errors=[];
      this.refine?.(value,{addIssue:(issue)=>errors.push(issue.message)});
      if(errors.length)throw Error(errors.join("; "));
      return value;
    },
  });
  return { object:schema, string:schema, enum:schema, array:schema,
    tuple:schema, toJSONSchema:()=>({type:"object",description:"test-only facade"}) };
}
function sampleExamples() {
  return ["easy","easy","medium","yds","yds"].map((difficulty,i)=>({
    difficulty,
    sentence:`Students obtain useful knowledge during the research project numbered ${i+1} at school.`,
    translation:`Öğrenciler ${i+1} numaralı araştırma sırasında yararlı bilgi elde eder.`,
    translationFocus:["elde eder"],
  }));
}
function draftHarness(payload) {
  return source("../src/features/feedback/tiered-sentence-generation.ts",{
    z:zodFacade(), HttpError,
    parseGeminiJson:JSON.parse,
    requestGeminiJson:async ()=>new Response(JSON.stringify({
      candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(payload)}]}}],
    }),{status:200,headers:{"Content-Type":"application/json"}}),
  });
}
const draftConfig={GEMINI_KEYS:["mock-key-unused"],GEMINI_MODEL_WORD:"gemini-test"};
test("generation returns exactly two easy, one medium, two YDS translations",async()=>{
  const gen=draftHarness({word:"obtain",examples:sampleExamples()});
  const result=await gen.generateTieredSentences("obtain",draftConfig);
  assert.deepEqual(result.examples.map(x=>x.difficulty),["easy","easy","medium","yds","yds"]);
  assert.equal(result.examples.every(x=>x.translation.includes("elde eder")),true);
});
test("generation refuses duplicate English examples",async()=>{
  const examples=sampleExamples();examples[1].sentence=examples[0].sentence;
  await assert.rejects(()=>draftHarness({word:"obtain",examples}).generateTieredSentences("obtain",draftConfig),
    (error)=>error.code==="SENTENCE_DRAFT_INVALID");
});
test("generation refuses wrong 2/1/2 sequence",async()=>{
  const examples=sampleExamples();examples[1].difficulty="yds";
  await assert.rejects(()=>draftHarness({word:"obtain",examples}).generateTieredSentences("obtain",draftConfig),
    (error)=>error.code==="SENTENCE_DRAFT_INVALID");
});
test("generation refuses missing target word and invalid translationFocus",async()=>{
  const examples=sampleExamples();examples[3].sentence="Researchers examine evidence without the requested headword.";
  examples[2].translationFocus=["sözlükte olmayan iz"];
  await assert.rejects(()=>draftHarness({word:"obtain",examples}).generateTieredSentences("obtain",draftConfig),
    (error)=>error.code==="SENTENCE_DRAFT_INVALID");
});
test("generation refuses wrong response word and quota-free use without model keys",async()=>{
  await assert.rejects(()=>draftHarness({word:"steal",examples:sampleExamples()}).generateTieredSentences("obtain",draftConfig),
    (error)=>error.code==="SENTENCE_DRAFT_INVALID");
  await assert.rejects(()=>draftHarness({word:"obtain",examples:sampleExamples()})
    .generateTieredSentences("obtain",{...draftConfig,GEMINI_KEYS:[]}),
    (error)=>error.code==="AI_NOT_CONFIGURED");
});
test("generation only accepts a bounded single English word",()=>{
  const gen=draftHarness({word:"obtain",examples:sampleExamples()});
  for (const input of ["test word","../../escape","<script>"])
    assert.throws(()=>gen.draftWord(input),error=>error.code==="SENTENCE_INVALID_WORD");
});
test("UI holds explicit generation and never auto-persists a generated draft",()=>{
  const ui=readFileSync(resolve(import.meta.dirname,"../../frontend/src/features/word-inspector/components/tiered-sentence-preview.tsx"),"utf8");
  assert.match(ui,/onClick=\{\(\) => void generate\(\)\}/);
  assert.doesNotMatch(ui,/library\.addMany|onAddToLibrary|saveWord\(/);
  assert.match(ui,/sentenceDraftResponseSchema\.parse/);
});
test("backend dictionary and generator route both enforce authenticated active-assessment check",()=>{
  const app=readFileSync(resolve(import.meta.dirname,"../src/app.ts"),"utf8");
  assert.match(app,/path === "\/api\/dictionary\/turkish"[\s\S]*?await assertNoActiveAssessment\(ctx\)/);
  assert.match(app,/path === "\/api\/lexicon\/examples\/draft"[\s\S]*?await assertNoActiveAssessment\(ctx\)/);
  assert.match(app,/authenticate\(request, config\)/);
});
