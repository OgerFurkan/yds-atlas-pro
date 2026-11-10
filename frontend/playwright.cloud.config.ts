import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/cloud",
  timeout: 60000,
  workers: 2,
  fullyParallel: true,
  expect: { timeout: 10000 },
  reporter: "list",
  outputDir: "test-results-cloud",
  use: { baseURL: "http://127.0.0.1:5178", trace: "retain-on-failure" },
  webServer: {
    command: "bun run dev -- --host 127.0.0.1 --port 5178 --strictPort",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_contract_test",
      VITE_API_URL: "",
      VITE_TEST_CACHE_DIR: "node_modules/.vite-cloud-tests",
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
