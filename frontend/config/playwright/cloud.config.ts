import type { PlaywrightTestConfig } from "@playwright/test";
import { previewServer } from "../../../scripts/quality/browser-config";
import { browserProfile, desktop, mobile } from "./base";
import { cloudPort, mockOrigin } from "./loopback";

export const cloudProfile = {
  testDir: "../../../tests/frontend/contracts",
  globalTimeout: 9 * 60_000,
  timeout: 60_000,
  workers: 2,
  fullyParallel: true,
  expect: { timeout: 10_000 },
  use: { baseURL: mockOrigin },
  webServer: previewServer("local-contract", cloudPort, "node_modules/.atlas-cloud-preview"),
  projects: [
    { name: "desktop", use: desktop },
    {
      name: "tablet",
      testMatch: ["**/feedback-inspector.spec.ts", "**/account-flow.spec.ts"],
      use: {
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: true,
        defaultBrowserType: "chromium",
      },
    },
    { name: "mobile", use: mobile },
  ],
} satisfies PlaywrightTestConfig;

export default browserProfile("cloud", cloudProfile);
