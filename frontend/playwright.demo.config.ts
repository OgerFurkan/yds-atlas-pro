import { defineConfig } from "@playwright/test";
import cloudConfig from "./playwright.cloud.config";

export default defineConfig({
  ...cloudConfig,
  testDir: "../tests/frontend/demo",
  timeout: 0,
  workers: 1,
  projects: cloudConfig.projects?.filter((project) => project.name === "desktop"),
  use: { ...cloudConfig.use, headless: false, serviceWorkers: "block", trace: "off" },
});
