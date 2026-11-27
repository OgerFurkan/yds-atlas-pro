import { browserProfile, desktop } from "./base";
import { cloudProfile } from "./cloud.config";

export default browserProfile("demo", {
  ...cloudProfile,
  testDir: "../../../tests/frontend/demo",
  timeout: 0,
  workers: 1,
  projects: [{ name: "desktop", use: desktop }],
  use: { ...cloudProfile.use, headless: false, trace: "off" },
});
