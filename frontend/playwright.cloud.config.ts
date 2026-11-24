import { defineConfig, devices } from "@playwright/test";
import { loopbackBrowser, mockOrigin } from "./playwright-local";
export default defineConfig({
  testDir: "../tests/frontend/contracts",
  timeout: 60000,
  workers: 2,
  fullyParallel: true,
  expect: { timeout: 10000 },
  reporter: "list",
  outputDir: "test-results-cloud",
  use: { ...loopbackBrowser, baseURL: mockOrigin, trace: "retain-on-failure" },
  webServer: {
    command:
      "bun run vite build --mode local-contract --outDir node_modules/.atlas-cloud-preview && " +
      "bun run preview -- --mode local-contract --outDir node_modules/.atlas-cloud-preview --host 127.0.0.1 --port 5178 --strictPort",
    url: mockOrigin,
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
