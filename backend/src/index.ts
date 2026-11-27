import { createApp } from "./app";
import { readRuntimeConfig } from "./config/env";

const config = readRuntimeConfig(Bun.env);
const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  maxRequestBodySize: 1_500_000,
  fetch: createApp(config),
});
console.info("YDS Atlas API: " + server.url.origin);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => void server.stop(true), 5_000);
  try {
    await server.stop();
  } finally {
    clearTimeout(deadline);
  }
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
