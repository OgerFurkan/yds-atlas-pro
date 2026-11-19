import { defineConfig } from "@playwright/test";
import cloud from "./playwright.cloud.config";

// Both UI flags are supplied by the caller for this local acceptance run.
if (
  process.env.VITE_FEEDBACK_INSPECTOR_UI_ENABLED !== "true" ||
  process.env.VITE_FEEDBACK_ADMIN_UI_ENABLED !== "true"
) {
  throw new Error("Yerel Feedback testi için iki arayüz bayrağı bu süreçte açık olmalı.");
}

const server = cloud.webServer;
if (!server || Array.isArray(server)) throw new Error("Tek bir yerel mock sunucusu gerekli.");

export default defineConfig({
  ...cloud,
  testMatch: "feedback-flow.spec.ts",
  webServer: {
    ...server,
    reuseExistingServer: false,
    env: {
      ...server.env,
      API_PROXY_TARGET: "http://127.0.0.1:1",
      VITE_FEEDBACK_INSPECTOR_UI_ENABLED: process.env.VITE_FEEDBACK_INSPECTOR_UI_ENABLED,
      VITE_FEEDBACK_ADMIN_UI_ENABLED: process.env.VITE_FEEDBACK_ADMIN_UI_ENABLED,
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
