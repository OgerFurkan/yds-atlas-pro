import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import {
  browserInventory,
  browserSummary,
  commandStatus,
  redact,
  safeSource,
  sourcePaths,
  syntheticEnv,
} from "./run-policy.mjs";

const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
const [profile, ...flags] = process.argv.slice(2);
if (
  !["quick", "local", "services", "release"].includes(profile) ||
  flags.some((arg) => !["--synthetic-schema", "--online-advisories"].includes(arg))
)
  throw new Error(
    "Usage: quality <quick|local|services|release> [--synthetic-schema] [--online-advisories]",
  );
const artifacts = join(root, ".artifacts", "quality");
mkdirSync(artifacts, { recursive: true });
const temp = mkdtempSync(join(artifacts, "atlas-quality-"));
const frontend = join(root, "frontend");
const env = syntheticEnv(process.env);
const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
const hash = () => {
  const h = createHash("sha256");
  for (const name of sourcePaths(git("ls-files", "-z", "-co", "--exclude-standard").split("\0"))) {
    const file = safeSource(root, name);
    h.update(name).update("\0");
    if (file) h.update(readFileSync(file));
    h.update("\0");
  }
  return h.digest("hex");
};
const fingerprint = hash();
const info = {
  profile,
  commit: git("rev-parse", "HEAD"),
  fingerprint,
  lockSha256: createHash("sha256")
    .update(readFileSync(join(root, "bun.lock")))
    .digest("hex"),
  node: process.version,
  platform: process.platform,
  steps: [],
};
let interrupted = false;
const active = new Set();
function stop(child, force = false) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const cleanup = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      env,
      windowsHide: true,
      stdio: "ignore",
    });
    cleanup.on("error", () => child.kill());
  } else {
    try {
      process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    for (const child of active) {
      stop(child);
      setTimeout(() => stop(child, true), 3000).unref();
    }
  });
const add = (step) => {
  info.steps.push(step);
  console.log(
    `${step.status} ${step.name}${step.code === null ? "" : " exit=" + step.code} ${step.ms}ms${step.detail ? " ? " + step.detail : ""}`,
  );
  return step;
};
const block = (name, kind, detail) =>
  add({ name, kind, status: "BLOCKED", code: null, ms: 0, detail });
async function run(name, kind, executable, args = [], options = {}) {
  if (interrupted) return block(name, kind, "Run interrupted.");
  const start = Date.now();
  let output = "";
  let timedOut = false;
  const code = await new Promise((done) => {
    const child = spawn(executable, args, {
      cwd: options.cwd ?? root,
      env: { ...env, ...options.env },
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    active.add(child);
    const timer = setTimeout(() => {
      timedOut = true;
      stop(child);
      setTimeout(() => stop(child, true), 3000).unref();
    }, options.timeout ?? 180_000);
    const capture = (chunk) => {
      output += chunk.toString();
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", (error) => {
      output += "\n" + error.code;
    });
    child.on("close", (code) => {
      active.delete(child);
      clearTimeout(timer);
      done(code ?? 1);
    });
  });
  writeFileSync(join(temp, name + ".log"), redact(output));
  let detail = timedOut ? "Command timed out." : undefined,
    valid = true;
  if (options.validate && code === 0 && !timedOut) {
    try {
      detail = options.validate(output);
    } catch (error) {
      valid = false;
      detail = error.message;
    }
  }
  return add({
    name,
    kind,
    status:
      !timedOut && options.blockedExit === code ? "BLOCKED" : commandStatus(code, valid, timedOut),
    code: timedOut ? 124 : code || (valid ? 0 : 1),
    ms: Date.now() - start,
    detail,
  });
}
const node = process.execPath;
const bun = (name, kind, args, options) =>
  run(name, kind, "bun", ["--no-install", "--no-env-file", ...args], options);
const quick = () =>
  Promise.all([
    run("typecheck-frontend", "static", node, ["scripts/quality/typecheck.mjs", "frontend"]),
    run("typecheck-backend", "static", node, ["scripts/quality/typecheck.mjs", "backend"]),
    bun("lint", "static", ["run", "lint"]),
    run("repository-audit", "static", node, ["scripts/quality/repository-audit.mjs"]),
    run("diff-check", "static", "git", ["diff", "--check", "HEAD"]),
  ]);
const sqlFile = "tests/backend/database/postgres-ownership-and-atomicity.test.ts";
const realFile = "tests/backend/database/isolated-score-security.test.ts";
const files = sourcePaths(git("ls-files", "-z", "-co", "--exclude-standard").split("\0")).filter(
  (file) => file.startsWith("tests/") && safeSource(root, file),
);
const nodeFiles = files.filter((file) => /\.node\.test\.[cm]?js$/.test(file));
const unitFiles = files.filter(
  (file) =>
    /(?:[._-](?:test|spec))\.[cm]?[jt]sx?$/.test(file) &&
    !nodeFiles.includes(file) &&
    !/\.spec\.ts$/.test(file) &&
    ![sqlFile, realFile].includes(file),
);
const bunCount = (output, expected) => {
  const plain = stripVTControlCharacters(output);
  const passes = Number(plain.match(/^\s*(\d+) pass\s*$/m)?.[1]);
  const sections = [...plain.matchAll(/^(tests[\\/].+):\r?$/gm)];
  const seen = new Set(
    sections
      .filter((section, index) =>
        /^\(pass\)/m.test(plain.slice(section.index, sections[index + 1]?.index)),
      )
      .map((row) => row[1].replaceAll("\\", "/")),
  );
  if (
    !passes ||
    /^\s*[1-9]\d* (?:skip|todo)\b/m.test(plain) ||
    (expected && (seen.size !== expected.length || expected.some((name) => !seen.has(name))))
  )
    throw new Error("Bun tests missing or skipped.");
  return `${passes} passed in ${seen.size} files`;
};
const unit = async () => {
  if (!unitFiles.length) throw new Error("No Bun tests discovered.");
  await bun("bun-tests", "synthetic", ["test", ...unitFiles.map((file) => "./" + file)], {
    validate: (output) => bunCount(output, unitFiles),
  });
  if (flags.includes("--synthetic-schema"))
    await bun("pglite", "isolated-sql", ["test", "./" + sqlFile], {
      validate: (output) => bunCount(output, [sqlFile]),
    });
  else block("pglite", "isolated-sql", "Loading migration SQL requires --synthetic-schema.");
};
async function port() {
  return await new Promise((done, fail) => {
    const socket = createServer().once("error", fail);
    socket.listen(0, "127.0.0.1", () => {
      const { port } = socket.address();
      socket.close((error) => (error ? fail(error) : done(port)));
    });
  });
}
const vite = join(frontend, "node_modules/vite/bin/vite.js");
const playwright = join(frontend, "node_modules/@playwright/test/cli.js");
async function build(name, mode, vars = {}) {
  const directory = join(temp, name);
  const step = await run(
    name,
    "synthetic-build",
    node,
    [vite, "build", "--mode", mode, "--outDir", directory],
    { cwd: frontend, env: vars },
  );
  if (step.status === "PASS") {
    const assets = readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((item) => item.isFile())
      .map((item) => join(item.parentPath, item.name))
      .sort();
    const digest = createHash("sha256");
    for (const asset of assets)
      digest
        .update(asset.slice(directory.length + 1).replaceAll("\\", "/"))
        .update("\0")
        .update(createHash("sha256").update(readFileSync(asset)).digest("hex"));
    step.artifact = { files: assets.length, sha256: digest.digest("hex") };
  }
  return { ...step, directory };
}
async function browser(name, config, vars) {
  const output = join(temp, name + "-playwright.json");
  const discoveryFile = join(temp, name + "-discovery.json");
  const args = [
    playwright,
    "test",
    "--config",
    join(frontend, config),
    "--workers",
    name === "guest-browser" ? "2" : "1",
  ];
  const common = { ...vars, ATLAS_BROWSER_RESULTS_DIR: join(temp, name + "-results") };
  let inventory;
  const discovery = await run(
    name + "-discovery",
    "test-discovery",
    node,
    [...args, "--list", "--reporter=json"],
    {
      cwd: frontend,
      env: { ...common, PLAYWRIGHT_JSON_OUTPUT_FILE: discoveryFile },
      validate: () => {
        inventory = JSON.parse(readFileSync(discoveryFile, "utf8"));
        return `${browserInventory(inventory).size} discovered`;
      },
    },
  );
  if (discovery.status !== "PASS") return block(name, "mock-browser", "Browser discovery failed.");
  await run(name, "mock-browser", node, [...args, "--reporter=list,json"], {
    cwd: frontend,
    timeout: 570_000,
    env: { ...common, PLAYWRIGHT_JSON_OUTPUT_FILE: output },
    validate: () => browserSummary(JSON.parse(readFileSync(output, "utf8")), name, inventory),
  });
}
async function browsers() {
  const guestPort = await port(),
    cloudPort = await port();
  const [guest, cloud] = await Promise.all([
    build("guest-build", "local-e2e"),
    build("cloud-build", "local-contract", { ATLAS_CLOUD_PORT: String(cloudPort) }),
  ]);
  // Keep Chromium groups separate to bound contention on the local host.
  if (guest.status === "PASS")
    await browser("guest-browser", "config/playwright/guest.config.ts", {
      ATLAS_GUEST_PORT: String(guestPort),
      ATLAS_BROWSER_BUILD_DIR: guest.directory,
    });
  else block("guest-browser", "mock-browser", "Guest build failed.");
  if (cloud.status === "PASS")
    await browser("cloud-browser", "config/playwright/cloud.config.ts", {
      ATLAS_CLOUD_PORT: String(cloudPort),
      ATLAS_BROWSER_BUILD_DIR: cloud.directory,
    });
  else block("cloud-browser", "mock-browser", "Cloud build failed.");
  for (const [name, config] of [
    ["cold-dev", "config/playwright/dev.config.ts"],
    ["fixtures", "config/playwright/fixtures.config.ts"],
  ]) {
    await browser(name, config, {
      ATLAS_DEV_PORT: String(await port()),
      VITE_TEST_CACHE_DIR: join(temp, name + "-cache"),
    });
  }
}
async function services() {
  if (!flags.includes("--synthetic-schema"))
    return block(
      "real-services",
      "isolated-services",
      "Loading migration SQL requires --synthetic-schema.",
    );
  if (process.platform !== "win32")
    return block(
      "real-services",
      "isolated-services",
      "Existing Docker fixture requires verified Docker Desktop Linux on Windows.",
    );
  const portNumber = String(await port());
  const web = await build("real-browser-build", "local-contract", { ATLAS_CLOUD_PORT: portNumber });
  if (web.status !== "PASS")
    return block("real-services", "isolated-services", "Real browser build failed.");
  return run(
    "real-services",
    "isolated-services",
    "python",
    [
      "tests/backend/database/isolated-services.py",
      "--allocate-ports",
      ...(profile === "release" ? [] : ["--skip-restore"]),
    ],
    {
      env: { ATLAS_ISOLATED_WEB_BUILD: web.directory, ATLAS_ISOLATED_WEB_PORT: portNumber },
      timeout: 520_000,
      validate: (output) => {
        const count = bunCount(output, [realFile]);
        if (
          profile === "release" &&
          !/^PASS class=restore_duration capture_ms=\d+ restore_acceptance_ms=\d+\r?$/m.test(output)
        )
          throw new Error("Isolated restore evidence is missing.");
        if (profile === "release" && !/^PASS class=restore_promotion_witness\r?$/m.test(output))
          throw new Error("Isolated restore promotion evidence is missing.");
        return count;
      },
    },
  );
}
const recovery = () =>
  run(
    "recovery-contracts",
    "synthetic-recovery",
    process.platform === "win32" ? "powershell.exe" : "pwsh",
    [
      "-NoProfile",
      ...(process.platform === "win32" ? ["-ExecutionPolicy", "RemoteSigned"] : []),
      "-File",
      "scripts/quality/atlas-recovery/tests/contracts.ps1",
    ],
    {
      validate: (output) => {
        if ((output.match(/^PASS class=manifest_receipt/gm) ?? []).length !== 3)
          throw new Error("Recovery evidence count is incomplete.");
        if (process.platform === "win32" && !/^PASS class=publication_mutex\r?$/m.test(output))
          throw new Error("Recovery mutex evidence is missing.");
        return process.platform === "win32"
          ? "3 manifest/receipt contracts and Windows mutex"
          : "3 manifest/receipt contracts";
      },
    },
  );
function recoveryImage() {
  const name = "recovery-image";
  const kind = "isolated-recovery";
  if (process.platform !== "win32" || !flags.includes("--synthetic-schema"))
    return block(
      name,
      kind,
      "Verified Windows Docker fixture and synthetic authorization required.",
    );
  return run(
    name,
    kind,
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "RemoteSigned",
      "-File",
      "scripts/quality/atlas-recovery.ps1",
      "-Mode",
      "Compatibility",
      "-WithVault",
    ],
    {
      timeout: 300_000,
      validate(output) {
        if ((output.match(/^PASS class=general_compatibility\r?$/gm) ?? []).length !== 1)
          throw new Error("Pinned Recovery image evidence is missing.");
        if (!/^PASS class=vault_ciphertext_and_synthetic_keys\r?$/m.test(output))
          throw new Error("Synthetic Vault evidence is missing.");
        return "Pinned extension compatibility, archive negative cases and synthetic Vault";
      },
    },
  );
}
try {
  const expected = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).packageManager;
  const bunVersion = execFileSync("bun", ["--no-env-file", "--version"], {
    cwd: root,
    env,
    encoding: "utf8",
  }).trim();
  const nodeVersion = readFileSync(join(root, ".node-version"), "utf8").trim();
  add({
    name: "runtime",
    kind: "static",
    status:
      expected === "bun@" + bunVersion && process.versions.node === nodeVersion ? "PASS" : "FAIL",
    code: expected === "bun@" + bunVersion && process.versions.node === nodeVersion ? 0 : 1,
    ms: 0,
    detail: `Node ${process.versions.node}, Bun ${bunVersion}`,
  });
  if (info.steps[0].status === "PASS") {
    if (profile !== "services") await quick();
    if (info.steps.some((step) => step.name === "repository-audit" && step.status !== "PASS"))
      throw new Error("Repository audit must establish source trust before execution.");
    if (profile === "local" || profile === "release") {
      await Promise.all([
        unit(),
        run(
          "node-tests",
          "synthetic",
          node,
          ["scripts/quality/node-inventory.mjs", join(temp, "node-executed.json"), ...nodeFiles],
          {
            validate: (output) => {
              const count = Number(output.match(/# pass (\d+)/)?.[1]);
              if (!count || /# skipped [1-9]/.test(output))
                throw new Error("Node tests missing or skipped.");
              return `${count} passed`;
            },
          },
        ),
        recovery(),
      ]);
      if (hash() !== fingerprint) throw new Error("Source changed before browser tests.");
      await browsers();
    }
    if (profile === "services" || profile === "release") await services();
    if (profile === "release") {
      await recoveryImage();
      await bun("biome-repository", "static", ["run", "check"]);
      if (flags.includes("--online-advisories"))
        await run(
          "dependency-advisories",
          "online-advisories",
          node,
          ["--use-system-ca", "scripts/quality/registry-advisories.mjs"],
          { timeout: 40_000, blockedExit: 2 },
        );
      else
        block(
          "dependency-advisories",
          "online-advisories",
          "Current advisory feed requires --online-advisories.",
        );
    }
  }
  if (hash() !== fingerprint) throw new Error("Source changed during the run.");
} catch (error) {
  add({
    name: "runner",
    kind: "static",
    status: "FAIL",
    code: 1,
    ms: 0,
    detail: redact(String(error.message)),
  });
} finally {
  info.status = info.steps.some((step) => step.status === "FAIL")
    ? "FAIL"
    : interrupted || info.steps.some((step) => step.status === "BLOCKED")
      ? "BLOCKED"
      : "PASS";
  const report = JSON.stringify(info, null, 2) + "\n";
  writeFileSync(join(temp, "summary.json"), report);
  if (process.env.ATLAS_QUALITY_REPORT) {
    const target = resolve(process.env.ATLAS_QUALITY_REPORT);
    // Evidence contains command identities and counts, never fixture logs or traces.
    writeFileSync(target, report, { flag: "wx" });
  }
  console.log(`${info.status} ${profile} ? ${temp}`);
  process.exitCode = interrupted
    ? 130
    : (info.steps.find((step) => step.status === "FAIL")?.code ??
      (info.status === "BLOCKED" ? 2 : 0));
}
