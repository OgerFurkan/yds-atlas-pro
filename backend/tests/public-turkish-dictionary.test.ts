import {describe,expect,test} from "bun:test";
import {dictionaryWord,parsePublicTurkish,lookupPublicTurkish} from "../src/features/lexicon/public-turkish-dictionary";
const license={name:"CC BY-SA 4.0",url:"https://creativecommons.org/licenses/by-sa/4.0/"};
const tr=(word:string)=>({language:{code:"tr"},word});
const make=(word:string,entries:unknown[])=>({word,source:{url:"https://en.wiktionary.org/wiki/"+word,license},entries});
const entry=(pos:string,senses:unknown[])=>({language:{code:"en"},partOfSpeech:pos,senses});
describe("licensed Turkish public dictionary safety",()=>{
 test("correct source and Turkish translations",()=>{
  const x=parsePublicTurkish("mitigate",make("mitigate",[entry("verb",[{translations:[tr("hafifletmek"),tr("azaltmak")]}])]));
  expect(x.status).toBe("ready");expect(x.entries[0].meanings).toEqual(["hafifletmek","azaltmak"]);expect(x.source?.license).toBe("CC BY-SA 4.0");
 });
 test("noun and verb are never guessed as one sense",()=>{
  const x=parsePublicTurkish("approach",make("approach",[entry("noun",[{translations:[tr("yaklaşım")]}]),entry("verb",[{translations:[tr("yaklaşmak")]}])]));
  expect(x.status).toBe("choices");expect(x.entries).toHaveLength(2);
 });
 test("missing Turkish stays missing and is never fabricated",()=>{
  const x=parsePublicTurkish("adverse",make("adverse",[entry("adjective",[{translations:[{language:{code:"es"},word:"adverso"}]}])]));
  expect(x.status).toBe("missing");expect(x.entries).toEqual([]);
 });
 test("an entirely unknown word yields missing",()=>{expect(parsePublicTurkish("blimble",{word:"blimble",entries:[],source:{url:"https://en.wiktionary.org",license}}).status).toBe("missing");});
 test("license, source spoofing, mismatched lemma are refused",()=>{
  const e=[entry("verb",[{translations:[tr("hafifletmek")]}])];
  expect(()=>parsePublicTurkish("mitigate",{word:"mitigate",entries:e,source:{url:"https://evil.example/wiki/mitigate",license}})).toThrow();
  expect(()=>parsePublicTurkish("mitigate",{word:"mitigate",entries:e,source:{url:"https://en.wiktionary.org/wiki/mitigate",license:{name:"Proprietary",url:license.url}}})).toThrow();
  expect(()=>parsePublicTurkish("mitigate",make("other",e))).toThrow();
 });
 test("invalid word inputs and URL-like words are refused",()=>{
  for(const w of ["","two words","a/b","aa?bb","ğ","x".repeat(46)])expect(()=>dictionaryWord(w)).toThrow();
  expect(dictionaryWord("  MITIGATE  ")).toBe("mitigate");
 });
 test("server only contacts fixed host, never user-supplied URLs",async()=>{
  let url="";
  const fake=(async(input:RequestInfo|URL)=>{url=String(input);return new Response(JSON.stringify(make("hypothesis",[entry("noun",[{translations:[tr("hipotez")]}])])),
    {status:200,headers:{"content-type":"application/json"}});}) as unknown as typeof fetch;
  const x=await lookupPublicTurkish("hypothesis","fixture-user",fake);
  expect(url).toBe("https://freedictionaryapi.com/api/v1/entries/en/hypothesis?translations=true");
  expect(x.entries[0].meanings).toEqual(["hipotez"]);
 });
 test("provider rate error fails with explicit code",async()=>{
  const fake=(async()=>new Response("{}",{status:429})) as unknown as typeof fetch;
  await expect(lookupPublicTurkish("consequently","fixture-user",fake)).rejects.toMatchObject({code:"DICTIONARY_UPSTREAM_ERROR"});
 });
 test("nested senses are bounded and can return Turkish",()=>{
  const x=parsePublicTurkish("mitigate",make("mitigate",[entry("verb",[{translations:[],subsenses:[{translations:[tr("yatıştırmak")]}]}])]));
  expect(x.entries[0].meanings).toEqual(["yatıştırmak"]);
 });
});
