import { createApp } from "./app";
import { readConfig } from "./config/env";
import { startTooltipPrewarmWorker } from "./features/lexicon/tooltip-prewarm";
const config = readConfig(Bun.env);
const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  maxRequestBodySize: 1_500_000,
  fetch: createApp(config),
});
console.info("YDS Atlas API: " + server.url.origin);
startTooltipPrewarmWorker(config);
