import { describe,expect,test } from "bun:test";
import {sentenceTokens,lemmaCandidates,planSentenceTerms,enqueueSentenceTerms,
 processSentenceTerms,lookupSentenceTerm} from "../src/features/lexicon/sentence-term-coverage";
describe("automatic sentence tooltip vocabulary coverage",()=>{
 test("deduplicates word forms; excludes markup numbers; enforces cap",()=>{
  expect(sentenceTokens(["Effects and effects reduce emissions.","Researchers reduce emissions."]))
   .toEqual(["effects","and","reduce","emissions","researchers"]);
  expect(sentenceTokens(["12345 and 345."])).toEqual(["and"]);
  expect(sentenceTokens(Array.from({length:2500},()=> "The word." )).length).toBeLessThanOrEqual(1500);
 });
 test("common grammar words are curated; ordinary words await verified lookup",()=>{
  const p=planSentenceTerms(["The researchers mitigate effects."]);
  expect(p.find(x=>x.word_key==="the")).toMatchObject({status:"ready",meanings:["belirli tanımlık"]});
  expect(p.find(x=>x.word_key==="mitigate")).toMatchObject({status:"pending",meanings:[]});
  expect(p.every(x=>!Object.keys(x).includes("user_id")&&!Object.keys(x).includes("sentence"))).toBe(true);
 });
 test("conservative morphological lookup prefers original form",()=>{
  expect(lemmaCandidates("effects")).toEqual(["effects","effect"]);
  expect(lemmaCandidates("studies")).toContain("study");
  expect(lemmaCandidates("reducing")).toContain("reduce");
 });
 test("queue inserts without overwriting existing reviewed entries",async()=>{
  const calls:unknown[]=[];
  const db={from:(name:string)=>({upsert:(data:unknown,opts:unknown)=>{
   calls.push({name,data,opts});return Promise.resolve({error:null});
  }})};
  expect(await enqueueSentenceTerms(db as never,["The climate affects health."])).toBe(4);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({name:"atlas_sentence_terms",opts:{onConflict:"word_key",ignoreDuplicates:true}});
 });
 test("bulk import scans sentences beyond the first 2000 without omissions",async()=>{
  const inserted=new Set<string>();
  const db={from:()=>({upsert:(data:Array<{word_key:string}>)=>{
   for(const x of data)inserted.add(x.word_key);return Promise.resolve({error:null});
  }})};
  const sentences=Array.from({length:2200},(_,i)=>i===2199?"Finalword appears.":"The common sentence.");
  await enqueueSentenceTerms(db as never,sentences);
  expect(inserted.has("finalword")).toBe(true);
 });
 test("ambiguous English word never creates invented Turkish translation",async()=>{
  const updates:unknown[]=[];
  const db={from:()=>({
   select:()=>({eq:()=>({lte:()=>({order:()=>({limit:async()=>({data:[{word_key:"bank",attempts:0}],error:null})})})})}),
   update:(v:unknown)=>({eq:()=>({eq:async()=>{updates.push(v);return {error:null}}})})
  })};
  const r=await processSentenceTerms(db as never,{lookup:async()=>({word:"bank",status:"choices",entries:[
   {partOfSpeech:"Noun",meanings:["banka"]},{partOfSpeech:"Noun",meanings:["nehir kıyısı"]}
  ]})});
  expect(r).toMatchObject({processed:1,ambiguous:1,ready:0});
  expect(updates[0]).toMatchObject({status:"ambiguous",meanings:[]});
 });
 test("verified licensed dictionary result is reusable and provenance preserved",async()=>{
  const updates:unknown[]=[];
  const db={from:()=>({
   select:()=>({eq:()=>({lte:()=>({order:()=>({limit:async()=>({data:[{word_key:"climate",attempts:0}],error:null})})})})}),
   update:(v:unknown)=>({eq:()=>({eq:async()=>{updates.push(v);return {error:null}}})})
  })};
  const r=await processSentenceTerms(db as never,{lookup:async()=>({
   word:"climate",status:"ready",entries:[{partOfSpeech:"Noun",meanings:["iklim"]}],
   source:{provider:"FreeDictionaryAPI.com / Wiktionary",url:"https://en.wiktionary.org/wiki/climate",
    license:"CC BY-SA 4.0",licenseUrl:"https://creativecommons.org/licenses/by-sa/4.0/"}
  })});
  expect(r).toMatchObject({ready:1,processed:1});
  expect(updates[0]).toMatchObject({status:"ready",meanings:["iklim"],license:"CC BY-SA 4.0"});
 });
 test("surface form takes precedence over guessed lemma",async()=>{
  const db={from:()=>({select:()=>({in:()=>({eq:()=>({limit:async()=>({data:[
   {word_key:"effect",part_of_speech:"Noun",meanings:["etki"],source:"curated",status:"ready"},
   {word_key:"effects",part_of_speech:"Noun",meanings:["etkiler"],source:"curated",status:"ready"}
  ],error:null})})})})})};
  expect((await lookupSentenceTerm(db as never,"effects"))?.meanings).toEqual(["etkiler"]);
 });
});
