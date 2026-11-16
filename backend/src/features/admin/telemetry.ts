import type { ServerConfig } from "../../config/env";
import { quotaClient } from "../../shared/supabase";

export type AtlasMetricName =
 "chat_pool_hit" | "chat_pool_generated" | "chat_ambiguous" | "chat_ai" |
 "lexicon_pool_hit" | "lexicon_generated" | "recommend_pool_hit" | "recommend_empty";

/** Best-effort structured counters; no prompts, messages, word content, PII or credentials. */
type SafeUsage={inputTokens?:number;outputTokens?:number;model?:string};
export async function telemetryEvent(config:ServerConfig,userId:string,
  name:AtlasMetricName,feature:"chat"|"lexicon"|"recommend",usage?:SafeUsage){
  try {
    const client=quotaClient(config);
    const tokens = usage && Number.isSafeInteger(usage.inputTokens)&&Number.isSafeInteger(usage.outputTokens)
      && usage.inputTokens!>=0&&usage.outputTokens!>=0
        ? {input_tokens:usage.inputTokens,output_tokens:usage.outputTokens}:{};
    const model = usage?.model && /^gemini-[a-z0-9.-]+$/.test(usage.model)?usage.model:null;
    const {error}=await client.from("atlas_usage_events").insert({user_id:userId,
      event_name:name,feature,...tokens,model});
    if(error)console.warn({service:"atlas-metrics",code:"EVENT_WRITE_FAILED"});
  }catch {console.warn({service:"atlas-metrics",code:"EVENT_UNAVAILABLE"});}
}
