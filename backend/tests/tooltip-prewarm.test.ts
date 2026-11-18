import {describe,expect,test} from "bun:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {readConfig} from "../src/config/env";
import {extractTooltipTokens,enqueueTooltipExamples,cachedTooltipBatch,drainTooltipQueue,
  adminBackfillTooltipPage,backfillTooltipPage} from "../src/features/lexicon/tooltip-prewarm";
const adminId="aa111111-1111-4111-8111-111111111111";
const OFF=readConfig({ATLAS_ADMIN_USER_ID:adminId});
const ON=readConfig({ATLAS_ADMIN_USER_ID:adminId,ATLAS_TOOLTIP_PREWARM_ENABLED:"true"});
const license="https://creativecommons.org/licenses/by-sa/4.0/";
const entry=(word:string,parts:{pos:string,tr:string}[])=>({
  word,source:{url:"https://en.wiktionary.org/wiki/"+word,license:{name:"CC BY-SA 4.0",url:license}},
  entries:parts.map(p=>({language:{code:"en"},partOfSpeech:p.pos,senses:[
    {translations:[{language:{code:"tr"},word:p.tr}]}]})),
});
const fakeFetch=(async(input:RequestInfo|URL)=>{
  const word=String(input).split("/").at(-1)?.split("?")[0];
  if(word==="policies")return new Response("missing",{status:404});
  if(word==="policy")return Response.json(entry("policy",[{pos:"noun",tr:"politika"}]));
  if(word==="approach")return Response.json(entry("approach",[
    {pos:"noun",tr:"yaklaşım"},{pos:"verb",tr:"yaklaşmak"}]));
  return new Response("not found",{status:404});
}) as typeof fetch;
describe("prewarmed sentence dictionary",()=>{
 test("deduplicates tokens, removes URLs/emails and never stores raw sentence content",()=>{
   const words=extractTooltipTokens([
     {sentence:"Governments should reduce emissions in Oxford."},
     {sentence:"Emissions and policy reforms reduce costs."},
     {sentence:"Please avoid https://example.net/private and john@example.org."},
   ]);
   expect(words).toContain("governments");
   expect(words).toContain("emissions");
   expect(words.filter(x=>x==="emissions")).toHaveLength(1);
   for(const bad of ["oxford","https","example","john","private"])expect(words).not.toContain(bad);
 });
 test("OFF leaves DB entirely untouched",async()=>{
   let calls=0;
   const db={from:()=>{calls++;throw Error("DB access");},rpc:()=>{calls++;throw Error("RPC access");}} as unknown as SupabaseClient;
   expect(await enqueueTooltipExamples(OFF,[{sentence:"We should reduce energy waste."}],db)).toBe(0);
   expect(await cachedTooltipBatch(OFF,["energy"],db)).toEqual({});
   expect(await drainTooltipQueue(OFF,db,fakeFetch)).toEqual({
     claimed:0,ready:0,choices:0,missing:0,retry:0});
   expect(calls).toBe(0);
 });
 test("queue payload contains only normalized English word keys",async()=>{
   let rows:unknown[]=[];
   const db={from:(table:string)=>{expect(table).toBe("atlas_sentence_tooltips");
     return {upsert:async (data:unknown[],options:unknown)=>{
       rows=data;expect(options).toEqual({onConflict:"word_key",ignoreDuplicates:true});
       return {error:null};
     }};}} as unknown as SupabaseClient;
   const count=await enqueueTooltipExamples(ON,[
     {sentence:"A stable policy reduces emissions."},
     {sentence:"Policy decisions influence emissions."},
   ],db);
   expect(count).toBeGreaterThan(3);
   expect(rows.every(x=>Object.keys(x as object).join(",")==="word_key")).toBe(true);
   expect(JSON.stringify(rows)).not.toContain("A stable policy");
   expect(rows.filter(x=>(x as {word_key:string}).word_key==="emissions")).toHaveLength(1);
 });
 test("worker handles inflections and genuinely ambiguous meanings",async()=>{
   const updates:Array<{word:string,change:any}>=[];
   const db={
     rpc:async()=>({error:null,data:[
       {word_key:"policies",lease_token:"11111111-1111-4111-8111-111111111111"},
       {word_key:"approach",lease_token:"22222222-2222-4222-8222-222222222222"},
     ]}),
     from:()=>({update:(change:any)=>({
       eq:(k:string,word:string)=>({
         eq:()=>({eq:async()=>{
           updates.push({word,change});return {error:null};
         }})
       })
     })}),
   } as unknown as SupabaseClient;
   const stats=await drainTooltipQueue(ON,db,fakeFetch);
   expect(stats).toEqual({claimed:2,ready:1,choices:1,missing:0,retry:0});
   const plural=updates.find(x=>x.word==="policies");
   expect(plural?.change.result.word).toBe("policy");
   const ambiguous=updates.find(x=>x.word==="approach");
   expect(ambiguous?.change.status).toBe("choices");
   expect(ambiguous?.change.result.entries).toHaveLength(2);
 });
 test("backfill scans multiple personal words but emits only shared tokens",async()=>{
   let inserted:unknown[]=[];
   const db={from:(table:string)=>{
     if(table==="words")return {select:()=>({order:()=>({limit:async()=>({data:[
       {id:"a",content:{examples:[{sentence:"Research improves safety."}]}},
       {id:"b",content:{examples:[{sentence:"Research helps policy makers."}]}},
     ],error:null})})})};
     return {upsert:async(data:unknown[])=>{inserted=data;return{error:null};}};
   }} as unknown as SupabaseClient;
   const info=await backfillTooltipPage(ON,null,50,db);
   expect(info).toMatchObject({scanned:2,done:true});
   expect(JSON.stringify(inserted)).toContain("research");
   expect(JSON.stringify(inserted)).not.toContain("Research improves safety");
   expect(JSON.stringify(inserted)).not.toContain('"id"');
 });
 test("admin backfill denies unauthorized users, flag disabled denies writes",async()=>{
   const ctx={userId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",db:{} as SupabaseClient};
   await expect(adminBackfillTooltipPage(ctx,ON,null)).rejects.toMatchObject({status:403});
   await expect(adminBackfillTooltipPage({...ctx,userId:adminId},OFF,null))
      .rejects.toMatchObject({status:404});
 });
 test("batch reads only valid unexpired licensed responses",async()=>{
   const source={provider:"FreeDictionaryAPI.com / Wiktionary",url:"https://en.wiktionary.org/wiki/reduce",license:"CC BY-SA 4.0",licenseUrl:license};
   const row=(key:string,expired=false)=>({word_key:key,status:"ready",result:{
     word:key,status:"ready",entries:[{partOfSpeech:"verb",meanings:["azaltmak"]}],source},
     expires_at:new Date(Date.now()+(expired?-120:120)*1000).toISOString()});
   const db={from:()=>({select:()=>({in:()=>({in:()=>({limit:async()=>({data:[
     row("reduce"),row("expire",true)],error:null})})})})})} as unknown as SupabaseClient;
   const result=await cachedTooltipBatch(ON,["reduce","expire"],db);
   expect(result.reduce?.entries[0].meanings).toEqual(["azaltmak"]);
   expect(result.expire).toBeUndefined();
 });
});

