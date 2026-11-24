import { defineConfig } from "@playwright/test";
import devConfig from "./playwright.dev.config";

export default defineConfig({
  ...devConfig,
  testIgnore: [],
  testMatch: "**/local-fixture-library.spec.ts",
  webServer: {
    ...devConfig.webServer,
    command: "bun run dev -- --mode local-fixtures --host 127.0.0.1 --port 5177 --strictPort",
  },
});
