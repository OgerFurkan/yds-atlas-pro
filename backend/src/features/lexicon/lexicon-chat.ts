import { hasCompleteTierSet, type AiChatRequest, type AiChatResponse } from "@yds-atlas/shared";
import type { ServerConfig } from "../../config/env";
import type { RequestContext } from "../../shared/supabase";
import { quotaClient } from "../../shared/supabase";
import { databaseError, HttpError } from "../../shared/errors";
import type { generateChatReply } from "../ai/chat";
import { lexiconStore } from "./lexicon-store";
import { lexicalIdentity } from "./lexicon-identity";
import { resolveTieredLexiconRequest } from "./lexicon-http";
import { telemetryEvent } from "../admin/telemetry";

const headwordPattern="([a-zA-Z]+(?:[ '-][a-zA-Z]+){0,2})";
const directPatterns=[
  new RegExp(`^${headwordPattern} (?:ne demek|ne anlama gelir|kelimesinin anlamı(?: nedir)?)\\??$`,"iu"),
  new RegExp(`^what does ${headwordPattern} mean\\??$`,"iu"),
  new RegExp(`^what is the meaning of ${headwordPattern}\\??$`,"iu"),
  new RegExp(`^${headwordPattern} (?:meaning|definition)\\??$`,"iu"),
];

/** A fail-closed deterministic route: sentences, multiple questions and commands go to Gemini. */
export function directWordQuestion(message:string):string|null {
  const text=message.normalize("NFKC").trim().replace(/\s+/g," ");
  if(text.length>150||/[\n\r;:{}<>]/.test(text))return null;
  for(const pattern of directPatterns){
    const match=pattern.exec(text);
    if(match){
      const word=match[1].trim();
      return word.length<=120?word:null;
    }
  }
  return null;
}

function composeWordReply(content:{word:string;partOfSpeech:string;meanings:string[];cefr:string;
  usageNote:string;examples:Array<{sentence:string;translation:string;difficulty?:string}>},reviewed:boolean){
  const example=content.examples.find(x=>x.difficulty==="medium")??content.examples[0];
  const status=reviewed?"Editoryal onaylı havuz kaydı":"Otomatik kontrollerden geçmiş AI destekli kayıt";
  const lines=[`${content.word} · ${content.partOfSpeech} · ${content.cefr}`,
    `Anlam: ${content.meanings.slice(0,3).join(" / ")}`,
    content.usageNote?`Kullanım: ${content.usageNote}`:undefined,
    example?`Örnek: ${example.sentence}\nTürkçesi: ${example.translation}`:undefined,
    `Kaynak: Atlas ortak kelime havuzu (${status}).`];
  return lines.filter(Boolean).join("\n").slice(0,4900);
}

export async function replyUsingLexiconOrAi(
  ctx:RequestContext,config:ServerConfig,input:AiChatRequest,signal:AbortSignal|undefined,
  generate:typeof generateChatReply,
  consumeQuota?: (userId: string) => Promise<boolean>,
):Promise<AiChatResponse>{
  const last=input.messages.at(-1)?.content??"";
  const direct=directWordQuestion(last);
  if(direct){
    // Access is only through an authenticated backend; pool data is service-only.
    const store=lexiconStore(quotaClient(config));
    const entries=(await store.findCandidates(direct.toLocaleLowerCase("en")))
      .filter(x=>{
        if(x.status!=="human_reviewed"&&x.status!=="machine_validated")return false;
        if(!hasCompleteTierSet(x.content.examples))return false;
        try{const identity=lexicalIdentity(x.content.word,x.content.partOfSpeech,x.content.meanings[0]);
          return identity.wordKey===x.wordKey&&identity.partOfSpeech===x.partOfSpeech&&identity.senseKey===x.senseKey;
        }catch{return false;}
      });
    if(entries.length>1){
      const choices=entries.slice(0,8).map(x=>`${x.partOfSpeech}: ${x.content.meanings[0]}`).join("\n");
      void telemetryEvent(config,ctx.userId,"chat_ambiguous","chat");
      return {reply:`Bu kelimenin birden fazla anlamı var. Hangi kullanımı soruyorsun?\n${choices}`,
        provider:"Lexicon",model:"atlas-lexicon-v1"};
    }
    // If pool is empty, resolve uses the same cache-first/lease/quota writer.
    const result=entries.length===1?{source:"pool" as const,entry:entries[0]}:
      await resolveTieredLexiconRequest(ctx,config,{word:direct},signal);
    void telemetryEvent(config,ctx.userId,result.source==="pool"?"chat_pool_hit":"chat_pool_generated","chat");
    return {reply:composeWordReply(result.entry.content,result.entry.status==="human_reviewed"),
      provider:"Lexicon",model:"atlas-lexicon-v1"};
  }
  if(!config.GEMINI_KEYS.length)throw new HttpError(503,"Gemini yapılandırılmadı.","AI_NOT_CONFIGURED");
  // Production uses the authenticated server-side quota RPC. Tests can inject
  // the same quota contract; never bypass quota for a Gemini chat response.
  const allowed=consumeQuota ? await consumeQuota(ctx.userId) : await (async()=>{
    const client=quotaClient(config);
    const quota=await client.rpc("consume_ai_quota",{p_user_id:ctx.userId});
    databaseError(quota.error);
    return quota.data===true;
  })();
  if(!allowed)throw new HttpError(429,"AI kullanım sınırına ulaşıldı.","AI_QUOTA_EXCEEDED");
  const reply=await generate(input,config,signal);
  void telemetryEvent(config,ctx.userId,"chat_ai","chat",{...reply.usage,model:reply.model});
  return reply;
}
