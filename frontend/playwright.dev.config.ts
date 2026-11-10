import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/dev",
  outputDir: "test-results-dev",
  timeout: 45000,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5177",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev -- --host 127.0.0.1 --port 5177 --strictPort --force",
    url: "http://127.0.0.1:5177",
    reuseExistingServer: false,
    env: { VITE_TEST_CACHE_DIR: "node_modules/.vite-cold-tests" },
  },
});
