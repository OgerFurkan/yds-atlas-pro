import {describe,expect,test} from "bun:test";
import {
 sentenceTokens,lemmaCandidates,glossaryRecord,processSharedLexiconWords,
 lookupSharedGloss,existingFullEntry,queueSentenceLexicon,pendingLexiconCount,
 tooltipWriteEnabled,scanSavedSentences
} from "../src/features/lexicon/sentence-lexicon-prefetch";
const source={provider:"FreeDictionaryAPI.com / Wiktionary" as const,
 url:"https://en.wiktionary.org/wiki/climate",license:"CC BY-SA 4.0" as const,
 licenseUrl:"https://creativecommons.org/licenses/by-sa/4.0/"};
const dictionary={word:"climate",status:"ready" as const,
 entries:[{partOfSpeech:"noun",meanings:["iklim"]}],source};
describe("single shared Lexicon sentence vocabulary automation",()=>{
 test("deduplicates sentence tokens without adding cheap grammar words",()=>{
  expect(sentenceTokens(["The effects and EFFECTS of climate change.","Climate policies reduce risks."]))
   .toEqual(["effects","climate","change","policies","reduce","risks"]);
 });
 test("large batch scanning does not truncate after 2000 sentences",()=>{
  const sentences=Array.from({length:2201},(_,i)=>i===2200?"Finalword emerges.":"The climate changes.");
  expect(sentenceTokens(sentences)).toContain("finalword");
 });
 test("morphological guesses never displace original surface form",()=>{
  expect(lemmaCandidates("effects")).toEqual(["effects","effect"]);
  expect(lemmaCandidates("studies")).toContain("study");
 });
 test("glossary is namespaced in existing canonical Lexicon table",()=>{
  const row=glossaryRecord("climate",dictionary);
  expect(row).toMatchObject({word_key:"climate",part_of_speech:"Tooltip",
   status:"machine_validated",revision:1,content:{kind:"atlas_tooltip_gloss_v1",
    examples:[],meanings:["iklim"]},
   provenance:{validation:"dictionary_verified_not_context_certified",
    license:"CC BY-SA 4.0"}});
  expect(row?.sense_key).toMatch(/^[0-9a-f]{64}$/);
  expect(row?.digest).toMatch(/^[0-9a-f]{64}$/);
 });
 test("ambiguity, missing source, missing dictionary word do not publish",()=>{
  expect(glossaryRecord("bank",{word:"bank",status:"choices",entries:[
   {partOfSpeech:"noun",meanings:["banka"]},{partOfSpeech:"noun",meanings:["nehir kıyısı"]}
  ],source})).toBeNull();
  expect(glossaryRecord("climate",{word:"climate",status:"missing",entries:[]})).toBeNull();
  expect(glossaryRecord("climate",{word:"climate",status:"ready",
   entries:[{partOfSpeech:"noun",meanings:["iklim"]}]})).toBeNull();
 });
 test("full canonical entry avoids external dictionary calls",async()=>{
  let calls=0;
  const r=await processSharedLexiconWords({} as never,["mitigate"],{
   alreadyFull:async()=>true,
   dictionary:async()=>{calls++;return dictionary;}
  });
  expect(calls).toBe(0);
  expect(r).toMatchObject({processed:1,existing:1,inserted:0});
 });
 test("cached short entry avoids repeated dictionary lookup",async()=>{
  let calls=0;
  const r=await processSharedLexiconWords({} as never,["climate"],{
   alreadyFull:async()=>false,alreadyCached:async()=>({word:"climate"}),
   dictionary:async()=>{calls++;return dictionary;}
  });
  expect(calls).toBe(0);
  expect(r).toMatchObject({processed:1,cached:1,inserted:0});
 });
 test("verified glossary inserted without overwriting canonical entry",async()=>{
  const saved:unknown[]=[];
  const r=await processSharedLexiconWords({} as never,["climate"],{
   alreadyFull:async()=>false,alreadyCached:async()=>null,
   dictionary:async()=>dictionary,persist:async row=>{saved.push(row);}
  });
  expect(r).toMatchObject({processed:1,inserted:1,errors:0});
  expect(saved[0]).toMatchObject({part_of_speech:"Tooltip"});
 });
 test("cache readback rejects unlicensed rows",async()=>{
  const row=glossaryRecord("climate",dictionary)!;
  const make=(record:unknown)=>({from:()=>({
   select:()=>({eq:()=>({eq:()=>({in:()=>({limit:async()=>({data:[record],error:null})})})})})
  })});
  expect(await lookupSharedGloss(make(row) as never,"climate"))
   .toMatchObject({word:"climate",meanings:["iklim"]});
  expect(await lookupSharedGloss(make({...row,
   provenance:{...row.provenance,license:"invalid"}}) as never,"climate")).toBeNull();
 });
 test("incomplete legacy rows are not mistaken for full Lexicon entries",async()=>{
  const db={from:()=>({select:()=>({eq:()=>({neq:()=>({in:()=>({limit:async()=>({data:[
   {part_of_speech:"Noun",status:"machine_validated",content:{meanings:["etki"],examples:[]}}
  ],error:null})})})})})})};
  expect(await existingFullEntry(db as never,"effect")).toBe(false);
 });
 test("server-side prefetch write is OFF unless explicitly enabled",()=>{
  const before=process.env.ATLAS_SENTENCE_PREFETCH_WRITE_ENABLED;
  delete process.env.ATLAS_SENTENCE_PREFETCH_WRITE_ENABLED;
  try{
   expect(tooltipWriteEnabled({ATLAS_FEEDBACK_LEXICON_ENABLED:true,SUPABASE_SECRET_KEY:"private"} as never)).toBe(false);
   process.env.ATLAS_SENTENCE_PREFETCH_WRITE_ENABLED="true";
   expect(tooltipWriteEnabled({ATLAS_FEEDBACK_LEXICON_ENABLED:true,SUPABASE_SECRET_KEY:"private"} as never)).toBe(true);
   expect(tooltipWriteEnabled({ATLAS_FEEDBACK_LEXICON_ENABLED:false,SUPABASE_SECRET_KEY:"private"} as never)).toBe(false);
  }finally{
   if(before===undefined)delete process.env.ATLAS_SENTENCE_PREFETCH_WRITE_ENABLED;
   else process.env.ATLAS_SENTENCE_PREFETCH_WRITE_ENABLED=before;
  }
 });
 test("backfill inspects only sentence content, never writes personal library",async()=>{
  let called=0;
  const db={from:(table:string)=>{
   expect(table).toBe("words");
   return {select:()=>({order:()=>({range:async()=>{
    called++;
    return {data:called===1?[{content:{examples:[{sentence:"Researchers mitigate risks."}]}}]:[],error:null};
   }})})};
  }};
  const n=await scanSavedSentences(db as never);
  expect(n).toBeGreaterThanOrEqual(1);
  expect(pendingLexiconCount()).toBeGreaterThanOrEqual(1);
 });
});
