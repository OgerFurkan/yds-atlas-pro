import { previewServer } from "../../../scripts/quality/browser-config";
import { browserProfile, standardProjects } from "./base";
import { guestOrigin, guestPort } from "./loopback";

export default browserProfile("guest", {
  testDir: "../../../tests/frontend/e2e",
  globalTimeout: 9 * 60_000,
  timeout: 90_000,
  fullyParallel: true,
  workers: 2,
  use: { baseURL: guestOrigin },
  webServer: previewServer("local-e2e", guestPort, "node_modules/.atlas-e2e-preview"),
  projects: standardProjects,
});
