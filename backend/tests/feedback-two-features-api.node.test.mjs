import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { resolve } from "node:path";

// Source-under-test: the actual backend createApp router, evaluated without
// contacting Supabase or Gemini. Everything outside the requested API path is
// explicitly substituted with offline, synthetic dependencies.
function source(path, bindings) {
  const text = readFileSync(resolve(import.meta.dirname, path), "utf8");
  const local = text
    .replace(/^import\b[\s\S]*?;\s*/gm, "")
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const)\b)/g, "");
  const body = typeof Bun === "undefined"
    ? nodeModule.stripTypeScriptTypes(local, { mode: "transform" })
    : new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(local);
  return new Function(...Object.keys(bindings), `${body}\nreturn {createApp};`)(...Object.values(bindings));
}
class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
class ZodError extends Error {}
const fakeSchema = () => ({
  min(){return this;},max(){return this;},int(){return this;},strict(){return this;},
  parse(value){return value;},
});
const z = {object:fakeSchema,string:fakeSchema,number:fakeSchema,uuid:fakeSchema,
  array:fakeSchema,ZodError};
const values = { lexicon: 0, draft: 0, dictionary: 0, account: 0, quota: 0 };
const examples = ["easy", "easy", "medium", "yds", "yds"].map((difficulty, i) => ({
  difficulty, sentence:`Students obtain reliable evidence from the experiment number ${i + 1}.`,
  translation:`Öğrenciler ${i + 1}. deneyden güvenilir kanıt elde eder.`, translationFocus:["elde eder"],
}));
const bindings = {
  z, HttpError, wordInputSchema:fakeSchema(),gameSessionSchema:fakeSchema(),
  geminiPoolStatus:()=>({}),databaseError:()=>{},
  authenticate:async request=>{
    if (request.headers.get("authorization") !== "Bearer sandbox-auth")
      throw new HttpError(401,"Oturum gerekli.","UNAUTHENTICATED");
    return {userId:"synthetic-user",db:{}};
  },
  quotaClient:()=>{ throw new Error("Real DB is forbidden in API smoke"); },
  assertGameSafeDictionaryWord:async()=>{},
  assertNoActiveAssessment:async ctx=>{
    if (ctx.activeGame) throw new HttpError(409,"Oyun sürüyor.","INSPECTOR_DURING_ASSESSMENT");
  },
  dictionaryWord:raw=>{
    const word=raw.trim().toLowerCase();
    if(!/^[a-z]{2,45}$/.test(word))throw new HttpError(400,"Invalid", "DICTIONARY_INVALID_WORD");
    return word;
  },
  lookupPublicTurkish:async(word,userId)=>{
    assert.equal(userId,"synthetic-user"); values.dictionary++;
    return {status:"ready",word,entries:[{partOfSpeech:"noun",meanings:["kanıt"]}],
      source:{provider:"FreeDictionaryAPI.com / Wiktionary",
        url:`https://en.wiktionary.org/wiki/${word}`,license:"CC BY-SA 4.0",
        licenseUrl:"https://creativecommons.org/licenses/by-sa/4.0/"}};
  },
  readSharedTooltipGloss:async()=>{throw new Error("No cache");},
  draftWord:raw=>{
    const word=raw.trim().toLowerCase();
    if(!/^[a-z]{2,45}$/.test(word))throw new HttpError(400,"Invalid", "SENTENCE_INVALID_WORD");
    return word;
  },
  queueSentenceWords:()=>{ values.lexicon++;return 3; },
  enqueueLegacyGlosses:async()=>({status:"queued",scannedWords:1,scannedSentences:5,queuedCandidates:12}),
  enqueueSentenceGlosses:async()=>({queued:3,distinct:3,capped:false}),
  sentencePrefetchEnabled:()=>false,
  readJson:async request=>request.json(),
};
const { createApp } = source("../src/app.ts", bindings);
const config = {
  ATLAS_FEEDBACK_LEXICON_ENABLED:true,APP_ORIGINS:"http://localhost",
  GEMINI_KEYS:["synthetic-never-used"], SUPABASE_SECRET_KEY:undefined,
  SUPABASE_URL:undefined,SUPABASE_PUBLISHABLE_KEY:undefined,
  GEMINI_MODEL_WORD:"gemini-synthetic",GEMINI_MODEL_CHAT:"gemini-synthetic",
};
function deps(extra={}) {
  return {
    authenticate:bindings.authenticate,
    consumeQuota:async id=>{values.quota++;assert.equal(id,"synthetic-user");return true;},
    generateTiered:async word=>{values.draft++;return {word,examples};},
    ...extra,
  };
}
const url="http://localhost";
function authHeaders(){return {authorization:"Bearer sandbox-auth"};}
test("real createApp GET: unknown personal word gets source-attributed Turkish dictionary fallback",async()=>{
  const before=values.dictionary;
  const response=await createApp(config,deps())(
    new Request(url+"/api/dictionary/turkish?word=evidence",{headers:authHeaders()}));
  assert.equal(response.status,200);
  const json=await response.json();
  assert.deepEqual(json.entries[0].meanings,["kanıt"]);
  assert.equal(json.source.license,"CC BY-SA 4.0");
  assert.equal(values.dictionary,before+1);
});
test("real createApp refuses unauthenticated dictionary query",async()=>{
  const before=values.dictionary;
  const response=await createApp(config,deps())(new Request(url+"/api/dictionary/turkish?word=evidence"));
  assert.equal(response.status,401);
  assert.equal((await response.json()).code,"UNAUTHENTICATED");
  assert.equal(values.dictionary,before);
});
test("real createApp generates exact 2+1+2 translations on explicit POST without library writes",async()=>{
  const before={...values};
  const response=await createApp(config,deps())(new Request(url+"/api/lexicon/examples/draft",{
    method:"POST",headers:{...authHeaders(),"content-type":"application/json"},
    body:JSON.stringify({word:"obtain"}),
  }));
  assert.equal(response.status,200);
  const json=await response.json();
  assert.equal(json.status,"draft");
  assert.deepEqual(json.examples.map(e=>e.difficulty),["easy","easy","medium","yds","yds"]);
  assert.equal(json.examples.every(e=>e.translation.includes("elde eder")),true);
  assert.equal(values.draft,before.draft+1);
  assert.equal(values.quota,before.quota+1);
  assert.equal(values.lexicon,before.lexicon); // Default-OFF shared write.
});
test("real createApp rejects disabled feature endpoints without generator",async()=>{
  const before=values.draft;
  const disabled={...config,ATLAS_FEEDBACK_LEXICON_ENABLED:false};
  const response=await createApp(disabled,deps())(new Request(url+"/api/lexicon/examples/draft",{
    method:"POST",headers:{...authHeaders(),"content-type":"application/json"},
    body:JSON.stringify({word:"obtain"}),
  }));
  assert.equal(response.status,404);
  assert.equal(values.draft,before);
});
test("active game allows safe context translations but protects answers and AI draft",async()=>{
  const before={...values};
  const scoped={...bindings,
    assertNoActiveAssessment:async()=>{throw new HttpError(409,"Oyun sürüyor.","INSPECTOR_DURING_ASSESSMENT");},
    assertGameSafeDictionaryWord:async(_ctx,word)=>{
      if(word==="supplant")throw new HttpError(409,"Cevap kapalı.","DICTIONARY_ANSWER_PROTECTED");
    },
  };
  const gameApp=source("../src/app.ts",scoped).createApp(config,deps());
  const safe=await gameApp(new Request(url+"/api/dictionary/turkish?word=evidence",{headers:authHeaders()}));
  assert.equal(safe.status,200);
  const protectedResult=await gameApp(new Request(url+"/api/dictionary/turkish?word=supplant",{headers:authHeaders()}));
  assert.equal(protectedResult.status,409);
  assert.equal((await protectedResult.json()).code,"DICTIONARY_ANSWER_PROTECTED");
  const generator=await gameApp(new Request(url+"/api/lexicon/examples/draft",{
    method:"POST",headers:{...authHeaders(),"content-type":"application/json"},
    body:JSON.stringify({word:"obtain"}),
  }));
  assert.equal(generator.status,409);
  assert.equal((await generator.json()).code,"INSPECTOR_DURING_ASSESSMENT");
  assert.equal(values.dictionary,before.dictionary+1);
  assert.equal(values.draft,before.draft);
  assert.equal(values.quota,before.quota);
});

test("authenticated legacy backfill is explicit and blocked during an active game",async()=>{
  const noGame=await createApp(config,deps())(new Request(url+"/api/lexicon/tooltip/backfill",{
    method:"POST",headers:authHeaders(),
  }));
  assert.equal(noGame.status,200);
  const queued=await noGame.json();
  assert.equal(queued.status,"queued");
  assert.equal(queued.scannedWords,1);
  const scoped={...bindings,assertNoActiveAssessment:async()=>{
    throw new HttpError(409,"Oyun sürüyor.","INSPECTOR_DURING_ASSESSMENT");
  }};
  const during=source("../src/app.ts",scoped).createApp(config,deps());
  const response=await during(new Request(url+"/api/lexicon/tooltip/backfill",{
    method:"POST",headers:authHeaders(),
  }));
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,"INSPECTOR_DURING_ASSESSMENT");
});
