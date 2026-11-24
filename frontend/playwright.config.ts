import { defineConfig, devices } from "@playwright/test";
import { loopbackBrowser } from "./playwright-local";

export default defineConfig({
  testDir: "../tests/frontend/e2e",
  timeout: 90_000,
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: { ...loopbackBrowser, baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command:
      "bun run preview -- --mode local-e2e --outDir node_modules/.atlas-e2e-preview --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
