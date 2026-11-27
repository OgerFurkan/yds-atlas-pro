import { isAbsolute } from "node:path";

export function loopbackPort(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1024 || Number(raw) > 65535)
    throw new Error(`Invalid loopback port in ${name}.`);
  return Number(raw);
}

export function previewServer(
  mode: "local-e2e" | "local-contract",
  port: number,
  fallback: string,
) {
  const build = process.env.ATLAS_BROWSER_BUILD_DIR ?? fallback;
  if (process.env.ATLAS_BROWSER_BUILD_DIR && !isAbsolute(build))
    throw new Error("The isolated build directory must be absolute.");
  // The command is passed through Playwright's shell, so accept only a literal path.
  if (/["$&|`<>^%!\r\n]/.test(build)) throw new Error("Invalid preview directory.");
  const preview = `node node_modules/vite/bin/vite.js preview --mode ${mode} --outDir "${build}" --host 127.0.0.1 --port ${port} --strictPort`;
  return {
    command:
      mode === "local-contract" && !process.env.ATLAS_BROWSER_BUILD_DIR
        ? `node node_modules/vite/bin/vite.js build --mode ${mode} --outDir "${build}" && ${preview}`
        : preview,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  };
}
