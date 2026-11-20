import { defineConfig } from "@playwright/test";
import cloud from "./playwright.cloud.config";

const server = cloud.webServer;
if (!server || Array.isArray(server)) throw new Error("Expected one isolated mock Vite server");

/** Opt-in, local-only Inspector acceptance. Never connect to real Supabase/API. */
export default defineConfig({
  ...cloud,
  testMatch: "feedback-inspector.spec.ts",
  outputDir: "test-results-feedback-inspector",
  webServer: {
    ...server,
    reuseExistingServer: false,
    env: {
      ...server.env,
      API_PROXY_TARGET: "http://127.0.0.1:1",
      VITE_FEEDBACK_INSPECTOR_UI_ENABLED: "true",
      VITE_FEEDBACK_ADMIN_UI_ENABLED: "false",
    },
  },
  use: {
    ...cloud.use,
    serviceWorkers: "block",
    launchOptions: {
      args: [
        "--disable-background-networking",
        "--proxy-server=http://127.0.0.1:1",
        "--proxy-bypass-list=localhost;127.0.0.1",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      ],
    },
  },
});
