import { createApp } from "./app";
import { readConfig } from "./config/env";
import { startPersistentTooltipWorker } from "./features/lexicon/persistent-tooltip-queue";

const config = readConfig(Bun.env);
const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  maxRequestBodySize: 1_500_000,
  fetch: createApp(config),
});
startPersistentTooltipWorker(config); // OFF until explicitly authorized server-only flags and migration.
console.info("YDS Atlas API: " + server.url.origin);
