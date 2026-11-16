import type { LexiconResolveRequest } from "@yds-atlas/shared";
import { generateWordList } from "../ai/gemini";
import type { ServerConfig } from "../../config/env";
import type { RequestContext } from "../../shared/supabase";
import { quotaClient } from "../../shared/supabase";
import { databaseError, HttpError } from "../../shared/errors";
import { tieredGenerator } from "./lexicon-generator";
import { LexiconProblem, resolveLexiconWord } from "./lexicon-resolver";
import { lexiconStore } from "./lexicon-store";
import { telemetryEvent } from "../admin/telemetry";

export async function resolveTieredLexiconRequest(
  _ctx: RequestContext,
  config: ServerConfig,
  input: LexiconResolveRequest,
  signal?: AbortSignal,
) {
  // _ctx is verified by app.ts/authenticate. No browser role can write shared tables.
  const admin = quotaClient(config);
  try {
    const response=await resolveLexiconWord(input,lexiconStore(admin),tieredGenerator(config,signal),async()=>{
      const q=await admin.rpc("consume_ai_quota",{p_user_id:_ctx.userId});
      databaseError(q.error);
      return q.data === true;
    });
    const usage=response.source==="generated"?response.entry.provenance.usage:undefined;
    const validUsage=usage&&typeof usage==="object"?usage as {inputTokens?:number;outputTokens?:number}:undefined;
    void telemetryEvent(config,_ctx.userId,response.source==="pool"?"lexicon_pool_hit":"lexicon_generated","lexicon",
      {...validUsage,model:config.GEMINI_MODEL_WORD});
    return response;
  }catch(e){
    if(e instanceof LexiconProblem)throw new HttpError(e.status,e.message,e.code);
    throw e;
  }
}

/** Each word is resolved independently. Partial success does not save unverified words. */
export async function completeTieredLexiconWords(
  ctx: RequestContext,config: ServerConfig,words: string[],signal?:AbortSignal,
) {
  const suggestions: Array<Awaited<ReturnType<typeof resolveTieredLexiconRequest>>["entry"]["content"]> = [];
  let firstError:unknown;
  for(const word of words){
    if(signal?.aborted)throw new HttpError(499,"İstek iptal edildi.","AI_CANCELLED");
    try {
      const entry=(await resolveTieredLexiconRequest(ctx,config,{word},signal)).entry;
      suggestions.push({...entry.content,lexicon:{entryId:entry.id,revision:entry.revision,contractVersion:1}});
    }
    catch(error){firstError??=error;
      // Retain valid previous successes; stop on quota and transient provider failures.
      if(error instanceof HttpError && (error.status===429||error.status>=500))break;
    }
  }
  if(!suggestions.length)throw firstError??new HttpError(503,"Kelime üretilemedi.","LEXICON_EMPTY");
  return {suggestions,provider:"Gemini" as const,model:config.GEMINI_MODEL_WORD};
}

/** Suggest arbitrary headwords, then reuse/publish verified tiered pool content per headword. */
export async function suggestTieredLexiconWords(ctx:RequestContext,config:ServerConfig,
  count:number,exclude:string[],signal?:AbortSignal){
  const admin=quotaClient(config);
  const q=await admin.rpc("consume_ai_quota",{p_user_id:ctx.userId});
  databaseError(q.error);
  if(q.data!==true)throw new HttpError(429,"AI kullanım sınırına ulaşıldı.","AI_QUOTA_EXCEEDED");
  const proposed=await generateWordList(count,exclude,config,signal);
  const names=proposed.suggestions.map(s=>s.word);
  return completeTieredLexiconWords(ctx,config,names,signal);
}

/** Return shareable lexical choices, not user content or progress. */
export async function listTieredLexiconCandidates(config:ServerConfig,word:string){
  const wordKey=word.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en");
  if(!/^[a-z]+(?:[ '-][a-z]+)*$/.test(wordKey)||wordKey.length>120)
    throw new HttpError(400,"Geçerli İngilizce kelime gerekli.","INVALID_WORD");
  const store=lexiconStore(quotaClient(config));
  const entries=await store.findCandidates(wordKey);
  return {candidates:entries.filter(e=>e.status!=="quarantined").map(e=>({
    partOfSpeech:e.partOfSpeech,meaning:e.content.meanings[0]??"",revision:e.revision,
  })).filter(e=>e.meaning)};
}
