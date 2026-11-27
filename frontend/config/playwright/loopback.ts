import { loopbackPort } from "../../../scripts/quality/browser-config.ts";

export const guestPort = loopbackPort("ATLAS_GUEST_PORT", 4173);
export const guestOrigin = `http://127.0.0.1:${guestPort}`;
export const cloudPort = loopbackPort("ATLAS_CLOUD_PORT", 5178);
export const mockOrigin = `http://127.0.0.1:${cloudPort}`;

export const loopbackBrowser = {
  serviceWorkers: "block" as const,
  launchOptions: {
    args: [
      "--disable-background-networking",
      "--proxy-server=http://127.0.0.1:1",
      "--proxy-bypass-list=localhost;127.0.0.1",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    ],
  },
};
