import { createApp } from "./app";
import { readConfig } from "./config/env";
import { startSentencePrefetch } from "./features/lexicon/sentence-lexicon-prefetch";
const config = readConfig(Bun.env);
const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  maxRequestBodySize: 1_500_000,
  fetch: createApp(config),
});
startSentencePrefetch(config); // OFF unless BOTH server-only flags and the existing audited RPCs are ready.
console.info("YDS Atlas API: " + server.url.origin);
