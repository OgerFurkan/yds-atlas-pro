import { loopbackPort } from "../../../scripts/quality/browser-config";
import { browserProfile, desktop } from "./base";

export const devPort = loopbackPort("ATLAS_DEV_PORT", 5177);
const origin = `http://127.0.0.1:${devPort}`;
const fixtureSpec = "**/local-fixture-library.spec.ts";

export function developmentProfile(fixtures: boolean) {
  const mode = fixtures ? "local-fixtures" : "local-dev";
  return browserProfile(
    fixtures ? "fixtures" : "cold-dev",
    {
      testDir: "../../../tests/frontend/dev",
      ...(fixtures ? { testMatch: fixtureSpec } : { testIgnore: fixtureSpec }),
      timeout: 45_000,
      workers: 1,
      use: { ...desktop, baseURL: origin },
      webServer: {
        command: `node node_modules/vite/bin/vite.js --mode ${mode} --host 127.0.0.1 --port ${devPort} --strictPort${fixtures ? "" : " --force"}`,
        url: origin,
        reuseExistingServer: false,
      },
    },
    true,
  );
}

export default developmentProfile(false);
