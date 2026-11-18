import { createApp } from "./app";
import { readConfig } from "./config/env";
import { startSentenceCoverageWorker } from "./features/lexicon/sentence-term-coverage";
const config = readConfig(Bun.env);
const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  maxRequestBodySize: 1_500_000,
  fetch: createApp(config),
});
startSentenceCoverageWorker(config);
console.info("YDS Atlas API: " + server.url.origin);
