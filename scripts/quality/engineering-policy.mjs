import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { safeSource, sourcePaths, syntheticEnv } from "./run-policy.mjs";

const credentialPatterns = [
  ["Google key", /\bAIza[\w-]{35}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[\w]{36,}|github_pat_[\w_]{40,})\b/],
  ["Supabase key", /\bsb_secret_[\w-]{20,}\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "database credentials",
    /postgres(?:ql)?:\/\/[^/\s:'"`]+:[^@/\s'"`]+@(?:[\w-]+\.)+(?:supabase\.co|supabase\.com)\b/i,
  ],
];
export function credentialKinds(source) {
  const kinds = credentialPatterns
    .filter(([, pattern]) => pattern.test(source))
    .map(([kind]) => kind);
  for (const jwt of source.match(/\beyJ[\w-]{12,}\.eyJ[\w-]{12,}\.[\w-]{20,}/g) ?? []) {
    try {
      if (JSON.parse(Buffer.from(jwt.split(".")[1], "base64url")).role === "service_role")
        kinds.push("privileged JWT");
    } catch {
      /* Ignore non-token text. */
    }
  }
  return [...new Set(kinds)];
}
export function workflowIssues(source) {
  const parsed = spawnSync(
    "bun",
    [
      "--no-install",
      "--no-env-file",
      "-e",
      "console.log(JSON.stringify(Bun.YAML.parse(await Bun.stdin.text())))",
    ],
    {
      input: source,
      encoding: "utf8",
      env: syntheticEnv(process.env),
      timeout: 5000,
    },
  );
  let workflow;
  try {
    if (parsed.status !== 0) throw new Error();
    workflow = JSON.parse(parsed.stdout);
  } catch {
    return ["workflow YAML could not be parsed"];
  }
  const issues = [];
  const readable = (permissions) =>
    permissions &&
    typeof permissions === "object" &&
    !Array.isArray(permissions) &&
    Object.entries(permissions).every(([key, value]) => key === "contents" && value === "read");
  if (!readable(workflow?.permissions) || workflow.permissions.contents !== "read")
    issues.push("workflow must declare contents: read");
  const events = workflow?.on;
  const triggers =
    typeof events === "string"
      ? [events]
      : Array.isArray(events)
        ? events
        : Object.keys(events ?? {});
  if (
    !triggers.length ||
    triggers.some((event) => !["pull_request", "push", "workflow_dispatch"].includes(event)) ||
    /\bsecrets\s*(?:\.|\[)|\btoJSON\s*\(\s*secrets\s*\)/i.test(source)
  )
    issues.push("privileged workflow feature requires separate review");
  const jobs = Object.values(workflow?.jobs ?? {});
  if (!jobs.length) issues.push("workflow has no jobs");
  for (const job of jobs) {
    if (job.permissions !== undefined && !readable(job.permissions))
      issues.push("job permissions exceed contents: read");
    if (job.uses || job.environment || job.secrets || job["runs-on"] !== "ubuntu-latest")
      issues.push("privileged workflow feature requires separate review");
    if (job["continue-on-error"] !== undefined) issues.push("mandatory job cannot bypass failures");
    for (const step of job.steps ?? []) {
      if (step["continue-on-error"] !== undefined)
        issues.push("mandatory step cannot bypass failures");
      if (step.uses !== undefined && !/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/.test(step.uses))
        issues.push("third-party action must use a full SHA");
      if (
        step.uses?.startsWith("actions/checkout@") &&
        (step.with?.["persist-credentials"] !== false || step.with.token || step.with["ssh-key"])
      )
        issues.push("checkout credentials must be disabled");
    }
  }
  return [...new Set(issues)];
}

export function engineeringIssues(root, files) {
  const issues = [];
  const check = (file, message) => issues.push({ file, message });
  for (const file of sourcePaths(files)) {
    let p;
    try {
      p = safeSource(root, file);
    } catch {
      check(file, "source symlink or non-regular file requires review");
      continue;
    }
    if (
      !p ||
      !/\.(?:[cm]?js|[jt]sx?|tsx?|json|md|sh|ps1|py|sql|lock|ya?ml|toml|example|html|css|svg)$/i.test(
        file,
      )
    )
      continue;
    const source = readFileSync(p, "utf8");
    for (const kind of credentialKinds(source)) check(file, kind);
    if (/^\.github\/workflows\/.*\.ya?ml$/.test(file))
      for (const warning of workflowIssues(source)) check(file, warning);
  }
  const read = (file) => readFileSync(join(root, file), "utf8");
  try {
    const lock = JSON.parse(read("bun.lock").replace(/,(\s*[}\]])/g, "$1"));
    if (lock.lockfileVersion !== 1) check("bun.lock", "unsupported lockfile format");
    for (const [path, workspace] of Object.entries(lock.workspaces)) {
      const file = path ? path + "/package.json" : "package.json";
      const manifest = JSON.parse(read(file));
      for (const field of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ]) {
        const stable = (value) => JSON.stringify(Object.entries(value ?? {}).sort());
        if (stable(workspace[field]) !== stable(manifest[field]))
          check(file, "stale lockfile " + field);
      }
      if (
        path === "packages/shared" &&
        Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).some((name) =>
          ["@yds-atlas/backend", "@yds-atlas/frontend"].includes(name),
        )
      )
        check(file, "shared package depends on an application");
    }
    const workspacePaths = new Set(Object.keys(lock.workspaces));
    for (const [name, item] of Object.entries(lock.packages)) {
      if (typeof item[0] !== "string") {
        check("bun.lock", "malformed package locator");
        continue;
      }
      const workspace = item[0].split("@workspace:")[1];
      if (
        workspace !== undefined
          ? !workspacePaths.has(workspace)
          : !item.some(
              (field) =>
                typeof field === "string" && /^sha(?:512|384|256|1)-[\w+/]+=*$/.test(field),
            ) ||
            item.some(
              (field) => typeof field === "string" && /^(?:https?:|git\+|file:|link:)/i.test(field),
            )
      )
        check("bun.lock", "unapproved source or missing integrity for " + name);
    }
  } catch {
    check("bun.lock", "invalid lockfile or workspace manifest");
  }
  const manifest = "scripts/quality/atlas-recovery/SHA256SUMS";
  if (!existsSync(join(root, manifest))) check(manifest, "Recovery source manifest missing");
  else {
    const rows = read(manifest).trim().split(/\r?\n/);
    if (
      createHash("sha256")
        .update(readFileSync(join(root, manifest)))
        .digest("hex") !== "41235ccdd5351e33512ca0eaef4a2191a3a4467ced477a9d422f49462d5b5037"
    )
      check(manifest, "Recovery source manifest hash does not match");
    try {
      const configPath = "scripts/quality/atlas-recovery/recovery.config.json";
      const entry = "scripts/quality/atlas-recovery.ps1";
      const config = JSON.parse(read(configPath));
      const configHash = createHash("sha256")
        .update(readFileSync(join(root, configPath)))
        .digest("hex");
      if (!read(entry).includes("$configHash = '" + configHash.toUpperCase() + "'"))
        check(entry, "Recovery runtime config pin does not match");
      for (const [name, digest] of Object.entries(config.files)) {
        if (!rows.includes(digest + "  atlas-recovery/" + name))
          check(configPath, "Recovery runtime file pin does not match source manifest");
      }
    } catch {
      check(manifest, "Invalid Recovery runtime pins");
    }
    for (const row of rows) {
      const match = /^([a-f0-9]{64}) {2}([\w./-]+)$/i.exec(row);
      if (!match || match[2].startsWith("/") || match[2].split("/").includes("..")) {
        check(manifest, "Invalid manifest entry");
        continue;
      }
      const file = "scripts/quality/" + match[2];
      if (
        !existsSync(join(root, file)) ||
        createHash("sha256")
          .update(readFileSync(join(root, file)))
          .digest("hex") !== match[1].toLowerCase()
      )
        check(file, "Recovery source hash does not match");
    }
  }
  return issues;
}
