import {expect,test} from "bun:test";
import { parseTurkishWiktionaryGloss, lookupTurkishWiktionaryGloss } from "../src/features/lexicon/tr-wiktionary";
import { lookupPublicTurkish } from "../src/features/lexicon/public-turkish-dictionary";
import { buildTooltipRecord, readSharedTooltipGloss } from "../src/features/lexicon/sentence-lexicon-prefetch";

function turkish(word:string, entries: unknown[]){
  return {edition:"tr",word,entries};
}
const nouns=(word:string,...glosses:string[])=>({
  word,lang_code:"en",pos:"noun",senses:[{glosses}],
});
const primary=(word:string)=>({
  word,entries:[{language:{code:"en"},partOfSpeech:"noun",
    senses:[{translations:[]}]}],
  source:{url:"https://en.wiktionary.org/wiki/"+word,
    license:{name:"CC BY-SA 4.0",url:"https://creativecommons.org/licenses/by-sa/4.0/"}},
});
test("Turkish Wiktionary emits source-backed Turkish noun gloss",()=>{
 const r=parseTurkishWiktionaryGloss("climate",turkish("climate",[nouns("climate","iklim","hava durumu")]));
 expect(r.status).toBe("ready");
 expect(r.entries[0].meanings).toEqual(["iklim","hava durumu"]);
 expect(r.source?.url).toBe("https://tr.wiktionary.org/wiki/climate");
 const record=buildTooltipRecord("climate",r)!;
 expect(record.part_of_speech).toBe("Tooltip");
 expect(record.provenance.provider).toBe("Wiktapi / Turkish Wiktionary");
 expect(record.provenance.validation).toBe("dictionary_verified_not_context_certified");
});
test("multiple Turkish Wiktionary parts of speech remain distinct",()=>{
 const r=parseTurkishWiktionaryGloss("approach",turkish("approach",[
  nouns("approach","yaklaşım"),
  {word:"approach",lang_code:"en",pos:"verb",senses:[{glosses:["yaklaşmak"]}]},
 ]));
 expect(r.status).toBe("choices");
 expect(buildTooltipRecord("approach",r)?.content.meanings).toEqual([
  "noun: yaklaşım","verb: yaklaşmak",
 ]);
});
test("wrong edition/word cannot impersonate a Turkish lexicon source",()=>{
 expect(()=>parseTurkishWiktionaryGloss("climate",turkish("deteriorate",[
  nouns("deteriorate","kötüleşmek")]))).toThrow();
 expect(()=>parseTurkishWiktionaryGloss("climate",{
  ...turkish("climate",[nouns("climate","iklim")]),edition:"en",
 })).toThrow();
 expect(parseTurkishWiktionaryGloss("climate",turkish("climate",[
  {word:"climate",lang_code:"de",pos:"noun",senses:[{glosses:["falsch"]}]},
 ])).status).toBe("missing");
});
test("missing English translations use Turkish edition through the same bounded fetcher",async()=>{
 const visited:string[]=[];
 const fetcher=async (input:unknown)=>{
  const uri=String(input);
  visited.push(uri);
  return new Response(JSON.stringify(uri.includes("freedictionaryapi.com")
    ?primary("climate")
    :turkish("climate",[nouns("climate","iklim")])),{status:200});
 };
 const r=await lookupPublicTurkish("climate","test-two-sources-unique",fetcher as typeof fetch);
 expect(r.status).toBe("ready");
 expect(r.entries[0].meanings).toEqual(["iklim"]);
 expect(visited).toHaveLength(2);
 expect(visited[1]).toBe("https://api.wiktapi.dev/v1/tr/word/climate?lang=en");
});
test("Turkish edition 429 remains a real error, never cached as a missing sense",async()=>{
 await expect(lookupTurkishWiktionaryGloss("climate",async()=>{
  return new Response(JSON.stringify({}),{status:429});
 } as typeof fetch)).rejects.toMatchObject({status:429,code:"DICTIONARY_RATE_LIMIT"});
});
test("cached Turkish Wiktionary gloss requires correct source domain and licensing",async()=>{
 const source=parseTurkishWiktionaryGloss("climate",turkish("climate",[nouns("climate","iklim")]));
 const record=buildTooltipRecord("climate",source)!;
 function fakeDatabase(provenance:typeof record.provenance){
  const row={word_key:"climate",part_of_speech:"Tooltip",status:"machine_validated",
    content:record.content,provenance};
  const chain={select(){return this;},eq(){return this;},limit(){return Promise.resolve({
   data:[row],error:null,
  });}};
  return {from(){return chain;}};
 }
 const good=await readSharedTooltipGloss(fakeDatabase(record.provenance) as never,"climate");
 expect(good?.meanings).toEqual(["iklim"]);
 expect(good?.provider).toBe("Wiktapi / Turkish Wiktionary");
 const hostile={...record.provenance,url:"https://evil.example/wiki/climate"};
 const rejected=await readSharedTooltipGloss(fakeDatabase(hostile) as never,"climate");
 expect(rejected).toBeNull();
});
