import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Use the filesystem spelling even when Windows launched this script through a case alias.
const root = realpathSync.native(fileURLToPath(new URL("../../", import.meta.url)));
const target = process.argv[2];
if (!["frontend", "backend"].includes(target)) throw new Error("Choose frontend or backend.");
const workspace = join(root, target);
const require = createRequire(join(workspace, "package.json"));
const name = `@typescript/typescript-${process.platform}-${process.arch}`;
const compilerFile = process.platform === "win32" ? "tsc.exe" : "tsc";
const compilerAt = (directory) => join(directory, "lib", compilerFile);
const meta = JSON.parse(readFileSync(require.resolve("typescript/package.json"), "utf8"));
if (meta.optionalDependencies?.[name] !== meta.version)
  throw new Error(`Unsupported native TypeScript platform or version: ${name}`);

let packageDir;
try {
  packageDir = dirname(require.resolve(name + "/package.json"));
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}
if (!packageDir || !existsSync(compilerAt(packageDir))) {
  packageDir = undefined;
  // Bun can leave an optional platform package in its cache without a workspace link.
  const cache = spawnSync("bun", ["--no-env-file", "pm", "cache"], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
  });
  const directory = cache.stdout?.trim();
  if (cache.status === 0 && directory && existsSync(directory)) {
    const prefix = basename(name) + "@" + meta.version;
    const candidates = [join(directory, dirname(name)), directory];
    for (const cacheRoot of candidates) {
      if (!existsSync(cacheRoot)) continue;
      packageDir = readdirSync(cacheRoot)
        .filter((entry) => entry === prefix || entry.startsWith(prefix + "@"))
        .map((entry) => join(cacheRoot, entry))
        .find((entry) => existsSync(join(entry, "package.json")) && existsSync(compilerAt(entry)));
      if (packageDir) break;
    }
  }
}
if (!packageDir)
  throw new Error(`Native compiler ${name}@${meta.version} is missing. Run frozen install.`);
const installed = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
if (installed.name !== name || installed.version !== meta.version)
  throw new Error("Native TypeScript package does not match the installed compiler version.");
const project = join(workspace, "tsconfig.json");
const result = spawnSync(
  join(packageDir, "lib", compilerFile),
  [target === "frontend" ? "-b" : "--project", project],
  { cwd: workspace, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
