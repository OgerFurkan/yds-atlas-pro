export const mockOrigin = "http://127.0.0.1:5178";

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
