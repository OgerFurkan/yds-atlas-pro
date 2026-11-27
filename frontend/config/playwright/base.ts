import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { loopbackBrowser } from "./loopback";

const resultsRoot = fileURLToPath(new URL("../../../.artifacts/playwright/", import.meta.url));

export const desktop = { ...devices["Desktop Chrome"] };
export const mobile = { ...devices["iPhone 13"], defaultBrowserType: "chromium" as const };
export const standardProjects = [
  { name: "desktop", use: desktop },
  { name: "mobile", use: mobile },
];

export function browserProfile(
  profile: string,
  options: PlaywrightTestConfig,
  development = false,
) {
  const runDir = join(resultsRoot, profile, randomUUID());
  const outputDir = process.env.ATLAS_BROWSER_RESULTS_DIR ?? join(runDir, "results");
  const config = defineConfig({
    reporter: "list",
    ...options,
    outputDir,
    use: { ...loopbackBrowser, trace: "retain-on-failure", ...options.use },
  });
  if (config.webServer && !Array.isArray(config.webServer)) {
    config.webServer.cwd = fileURLToPath(new URL("../../", import.meta.url));
    if (development) {
      config.webServer.env = {
        ...config.webServer.env,
        VITE_TEST_CACHE_DIR: process.env.VITE_TEST_CACHE_DIR ?? join(runDir, "vite"),
      };
    }
  }
  return config;
}
