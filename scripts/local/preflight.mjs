#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const checks = [];
function command(name, args, timeout = 6000) {
  const result = spawnSync(name, args, { cwd: root, encoding: "utf8", timeout, shell: process.platform === "win32" });
  return { ok: result.status === 0, detail: result.status === 0 ? String(result.stdout).trim().split("\n")[0].slice(0, 100) : "unavailable (or failed)" };
}
function record(name, ok, detail) { checks.push({name, status: ok ? "PASS" : "BLOCKED", detail}); }
record("node>=20", Number(process.versions.node.split(".")[0]) >= 20, "Node " + process.versions.node);
record("checkout", existsSync(join(root, "bun.lock")) && existsSync(join(root, "supabase/config.toml")), "Expected repository files");
const wsl = process.platform === "linux" && existsSync("/proc/version") && /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"));
record("os", ["linux", "darwin", "win32"].includes(process.platform), process.platform + (wsl ? " (WSL)" : ""));
const bun = command("bun", ["--version"]); record("bun", bun.ok, bun.detail);
const cli = command(process.platform === "win32" ? join(root,"node_modules/.bin/supabase.cmd") : join(root,"node_modules/.bin/supabase"), ["--version"]);
record("supabase-cli", cli.ok, cli.detail);
const remote = !!process.env.DOCKER_HOST && !/^(unix:\/\/|npipe:\/\/|tcp:\/\/(127\.0\.0\.1|localhost):)/.test(process.env.DOCKER_HOST);
if (remote) record("docker-daemon", false, "Remote DOCKER_HOST refused");
else { const d = command("docker", ["info","--format","{{.ServerVersion}}"]); record("docker-daemon", d.ok, d.detail); }
console.log(JSON.stringify({kind:"LOCAL_PREFLIGHT_ONLY",checks},null,2));
if (checks.some(x => x.status !== "PASS")) process.exitCode=2;
