import { describe, expect, test } from "bun:test";
import type { LexicalContent, LexiconEntry, LexiconStore } from "../src/features/lexicon/lexicon-resolver";
import { resolveLexiconWord } from "../src/features/lexicon/lexicon-resolver";
import { lexicalIdentity } from "../src/features/lexicon/lexicon-identity";

const examples = [
  {sentence:"We obtain permits.",translation:"İzinleri alıyoruz.",translationFocus:["alıyoruz"],difficulty:"easy" as const},
  {sentence:"Please obtain a receipt.",translation:"Lütfen makbuz alın.",translationFocus:["alın"],difficulty:"easy" as const},
  {sentence:"Applicants must obtain written permission before entering the laboratory.",translation:"Başvuranlar laboratuvara girmeden önce yazılı izin almalıdır.",translationFocus:["almalıdır"],difficulty:"medium" as const},
  {sentence:"Although initial results were inconclusive, the researchers managed to obtain additional evidence from a series of controlled clinical trials.",translation:"İlk sonuçlar belirsiz olsa da araştırmacılar bir dizi kontrollü klinik deneyden ek kanıt elde etmeyi başardı.",translationFocus:["elde etmeyi"],difficulty:"yds" as const},
  {sentence:"To obtain a reliable estimate of the long-term environmental impact, the committee commissioned a comprehensive review of the available scientific literature.",translation:"Uzun vadeli çevresel etkiyi güvenilir biçimde tahmin etmek için komite mevcut bilimsel literatürün kapsamlı bir incelemesini yaptırdı.",translationFocus:["tahmin etmek"],difficulty:"yds" as const},
];
const content: LexicalContent = {word:"Obtain",partOfSpeech:"Verb",meanings:["Elde etmek"],alternatives:[],usageNote:"Bir şeyi edinmek.",cefr:"B2",examples};
function memoryStore(entries: LexiconEntry[]=[],leaseEnabled=true){
  let quotaCalls=0,generateCalls=0,publishCalls=0;
  const store:LexiconStore={
    async findCandidates(wordKey){return entries.filter(e=>e.wordKey===wordKey);},
    async claim(){return leaseEnabled;},
    async publish(_lease,identity,value,provenance){publishCalls++;
      const found=entries.find(e=>e.wordKey===identity.wordKey&&e.senseKey===identity.senseKey&&e.partOfSpeech===identity.partOfSpeech);
      if(found)return found;
      const entry={...identity,id:"b75d6cca-65a6-40ec-a071-555555555555",revision:1,status:"machine_validated" as const,
        content:value,provenance};entries.push(entry);return entry;},
    async fail(){},
  };
  const generate=async()=>{generateCalls++;return {content,provenance:{provider:"Gemini"}};};
  const quota=async()=>{quotaCalls++;return true;};
  const stats=()=>({quotaCalls,generateCalls,publishCalls});
  return {store,generate,quota,stats};
}
const request={word:"Obtain",partOfSpeech:"Verb",meaning:"Elde etmek"};
describe("shared lexicon cache-first boundary",()=>{
  test("first request generates and stores; next user gets cache HIT without quota",async()=>{
    const x=memoryStore();
    expect((await resolveLexiconWord(request,x.store,x.generate,x.quota)).source).toBe("generated");
    expect((await resolveLexiconWord(request,x.store,x.generate,x.quota)).source).toBe("pool");
    expect(x.stats()).toEqual({quotaCalls:1,generateCalls:1,publishCalls:1});
  });
  test("lease prevents expensive duplicate generation",async()=>{
    const x=memoryStore([],false);
    await expect(resolveLexiconWord(request,x.store,x.generate,x.quota)).rejects.toHaveProperty("code","LEXICON_GENERATING");
    expect(x.stats().quotaCalls).toBe(0);
  });
  test("same spelling but wrong POS and sense never collides",async()=>{
    const x=memoryStore();
    await expect(resolveLexiconWord({...request,partOfSpeech:"Noun"},x.store,x.generate,x.quota))
      .rejects.toHaveProperty("code","LEXICON_WRONG_SENSE");
    expect(x.stats().publishCalls).toBe(0);
  });
  test("multiple legitimate meanings require disambiguation",async()=>{
    const base=lexicalIdentity(content.word,content.partOfSpeech,content.meanings[0]);
    const other=lexicalIdentity(content.word,content.partOfSpeech,"Ulaşmak");
    const entry=(key:typeof base):LexiconEntry=>({...key,id:"b75d6cca-65a6-40ec-a071-555555555555",revision:1,
      status:"machine_validated",content,provenance:{}});
    const x=memoryStore([entry(base),{...entry(other),content:{...content,meanings:['Ulaşmak']}}]);
    await expect(resolveLexiconWord({word:"Obtain"},x.store,x.generate,x.quota))
      .rejects.toHaveProperty("code","LEXICON_AMBIGUOUS");
  });
});
