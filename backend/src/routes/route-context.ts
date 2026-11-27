import type { ServerConfig } from "../config/env";
import type { generateChatReply } from "../features/ai/chat";
import type {
  generateNamedWordsWithDictionary,
  generateWord,
  generateWordList,
} from "../features/ai/gemini";
import type { generateTieredSentences } from "../features/feedback/tiered-sentence-generation";
import type { AssessmentWriter } from "../features/learning/assessment-writer";
import type { Readiness } from "../features/operations/operations";
import type { RequestContext } from "../shared/supabase";

export type Dependencies = {
  authenticate?: (request: Request) => Promise<RequestContext>;
  generate?: typeof generateWord;
  generateList?: typeof generateWordList;
  generateNamed?: typeof generateNamedWordsWithDictionary;
  generateChat?: typeof generateChatReply;
  consumeQuota?: (userId: string) => Promise<boolean>;
  generateTiered?: typeof generateTieredSentences;
  assessmentWriter?: AssessmentWriter;
  readiness?: () => Promise<Readiness>;
};
export type RouteContext = {
  request: Request;
  path: string;
  ctx: RequestContext;
  config: ServerConfig;
  dependencies: Dependencies;
  beginAi: (userId: string) => Promise<void>;
  assessmentWriter: AssessmentWriter;
};
export const unmatchedRoute = Symbol("unmatched route");
