import { defineConfig, devices } from "@playwright/test";
import smoke from "./playwright.config";

// Opt-in manual LOCAL quality suite; not a signed-in provider/axe/visual acceptance.
export default defineConfig({
 ...smoke,
 testDir:"./tests/quality",
 outputDir:"test-results-quality",
 workers:2,
 retries:0,
 use:{...smoke.use,serviceWorkers:"block",trace:"retain-on-failure"},
 projects:[
  {name:"qa-chromium-desktop",use:{...devices["Desktop Chrome"]}},
  {name:"qa-firefox-desktop",use:{...devices["Desktop Firefox"]}},
  {name:"qa-webkit-mobile",use:{...devices["iPhone 13"]}},
  {name:"qa-chromium-tablet",use:{...devices["iPad (gen 7)"],defaultBrowserType:"chromium"}},
 ],
});
