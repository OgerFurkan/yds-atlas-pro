import { browserProfile } from "./base";
import { cloudProfile } from "./cloud.config";

/** Opt-in Inspector acceptance against the same loopback HTTP mocks as the cloud suite. */
export default browserProfile("inspector", {
  ...cloudProfile,
  testMatch: "feedback-inspector.spec.ts",
  webServer: {
    ...cloudProfile.webServer,
    env: {
      API_PROXY_TARGET: "http://127.0.0.1:1",
      VITE_FEEDBACK_INSPECTOR_UI_ENABLED: "true",
      VITE_FEEDBACK_ADMIN_UI_ENABLED: "false",
    },
  },
});
