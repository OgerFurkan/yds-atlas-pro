import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loopbackPort } from "../../../scripts/quality/browser-config";

export async function verifyDevices(
  directory: string,
  gateway: string,
  app: (req: Request) => Promise<Response>,
  credentials: { email: string; password: string },
  owner: string,
  practice: { word: string; meaning: string }[],
) {
  const published = resolve(directory);
  const web = Bun.serve({
    hostname: "127.0.0.1",
    idleTimeout: 30,
    port: loopbackPort("ATLAS_ISOLATED_WEB_PORT", 5178),
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/api/")) return app(req);
      if (path.startsWith("/auth/v1/") || path.startsWith("/rest/v1/"))
        return fetch(new URL(path + new URL(req.url).search, gateway), {
          headers: req.headers,
          method: req.method,
          body: req.body,
          redirect: "error",
        });
      const file = resolve(published, "." + (path === "/" ? "/index.html" : path));
      if (!file.startsWith(published + sep)) return new Response(null, { status: 404 });
      const asset = Bun.file(file);
      return (await asset.exists()) ? new Response(asset) : new Response(null, { status: 404 });
    },
  });
  const report = join(tmpdir(), "atlas-device-" + crypto.randomUUID() + ".json");
  try {
    const worker = Bun.spawn(
      ["node", fileURLToPath(new URL("./browser-devices.worker.mjs", import.meta.url))],
      {
        stdin: new Blob([
          JSON.stringify({ origin: web.url.href, credentials, owner, practice, report }),
        ]),
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if ((await worker.exited) !== 0) throw new Error("Two-device browser acceptance failed.");
    return JSON.parse(await readFile(report, "utf8")).sessionId as string;
  } finally {
    web.stop(true);
    await unlink(report).catch(() => {});
  }
}
