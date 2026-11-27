import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

function requireContract(ok) {
  if (!ok) throw new Error("Atlas Recovery PostgREST acceptance");
}

function createHarness(session, context, apiPrefix) {
  const databaseName = "atlas-backup-" + session;
  const apiName = apiPrefix + session;
  const dockerEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^DOCKER_/i.test(key)),
  );
  const iterations = 100;

  function docker(...args) {
    return execFileSync("docker.exe", ["--context", context, ...args], {
      encoding: "utf8",
      env: dockerEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 6_000,
      windowsHide: true,
    }).trim();
  }

  function tryDocker(...args) {
    try {
      return docker(...args);
    } catch {
      return null;
    }
  }

  function assert(condition) {
    if (!condition) throw new Error("synthetic verification failed");
  }

  function inventory() {
    const queries = [
      ["container", "ls", "-a", "--no-trunc", "--format", "{{.ID}}|{{.Names}}|{{.State}}"],
      ["volume", "ls", "--format", "{{.Name}}|{{.Driver}}"],
      ["network", "ls", "--no-trunc", "--format", "{{.ID}}|{{.Name}}"],
      ["image", "ls", "--no-trunc", "--format", "{{.ID}}|{{.Repository}}:{{.Tag}}"],
    ];
    return JSON.stringify(
      queries.map((args) =>
        docker(...args)
          .split(/\r?\n/)
          .sort(),
      ),
    );
  }

  function verifyDatabase(id) {
    const entry = JSON.parse(docker("container", "inspect", "--format", "{{json .}}", id));
    assert(entry.Id === id && entry.Name === "/" + databaseName);
    assert(entry.Config.Labels["atlas.backup.owner"] === databaseName);
    assert(entry.State.Running && entry.HostConfig.NetworkMode === "none");
    assert(
      !entry.HostConfig.PublishAllPorts && !Object.keys(entry.HostConfig.PortBindings ?? {}).length,
    );
    assert(Object.keys(entry.NetworkSettings.Networks ?? {}).every((key) => key === "none"));
  }

  function removeSidecar() {
    const id = docker(
      "container",
      "ls",
      "-aq",
      "--no-trunc",
      "--filter",
      "label=atlas.prototype.sidecar=" + session,
    );
    if (!id) return;
    assert(/^[a-f0-9]{64}$/.test(id));
    const typed = JSON.parse(docker("container", "inspect", "--format", "{{json .}}", id));
    assert(
      typed.Name === "/" + apiName && typed.Config.Labels["atlas.prototype.sidecar"] === session,
    );
    docker("container", "rm", "--force", id);
    assert(
      !docker("container", "ls", "-aq", "--filter", "label=atlas.prototype.sidecar=" + session),
    );
  }

  function jwt(key, subject) {
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
    const claims = Buffer.from(
      JSON.stringify({
        role: "prototype_authenticated",
        sub: subject,
        exp: Math.floor(Date.now() / 1000) + 120,
      }),
    ).toString("base64url");
    const body = header + "." + claims;
    return body + "." + createHmac("sha256", key).update(body).digest("base64url");
  }

  function request(database, query, token) {
    const args = ["exec", database, "curl", "-sS", "--max-time", "3", "-w", "\n%{http_code}"];
    if (token) args.push("-H", "Authorization: Bearer " + token);
    const response = docker(...args, "http://127.0.0.1:3000/words?" + query);
    const lastLine = response.lastIndexOf("\n");
    return { status: response.slice(lastLine + 1), rows: JSON.parse(response.slice(0, lastLine)) };
  }

  async function waitForDatabase(child) {
    for (let attempt = 0; attempt < iterations && child.exitCode === null; attempt++) {
      const id = tryDocker(
        "container",
        "ls",
        "-q",
        "--no-trunc",
        "--filter",
        "label=atlas.backup.owner=" + databaseName,
      );
      if (
        /^[a-f0-9]{64}$/.test(id ?? "") &&
        tryDocker("exec", id, "test", "-f", "/tmp/prototype-postgrest-ready") !== null
      ) {
        verifyDatabase(id);
        return id;
      }
      await delay(350);
    }
    throw new Error("prototype target unavailable");
  }

  async function testRealPostgrest(database, cachedImage) {
    verifyDatabase(database);
    const key = randomBytes(48).toString("base64url");
    const id = docker(
      "create",
      "--name",
      apiName,
      "--label",
      "atlas.prototype.sidecar=" + session,
      "--pull",
      "never",
      "--network",
      "container:" + database,
      "--log-driver",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--memory",
      "256m",
      "--memory-swap",
      "256m",
      "--env",
      "PGRST_DB_URI=postgresql://prototype_authenticator@127.0.0.1:5432/postgres",
      "--env",
      "PGRST_DB_SCHEMAS=prototype_app",
      "--env",
      "PGRST_DB_ANON_ROLE=prototype_anon",
      "--env",
      "PGRST_JWT_SECRET=" + key,
      "--env",
      "PGRST_SERVER_HOST=127.0.0.1",
      "--env",
      "PGRST_SERVER_PORT=3000",
      cachedImage,
    );
    assert(/^[a-f0-9]{64}$/.test(id));
    const spec = JSON.parse(docker("container", "inspect", "--format", "{{json .}}", id));
    assert(spec.Name === "/" + apiName && spec.Image === cachedImage);
    assert(
      spec.HostConfig.NetworkMode === "container:" + database &&
        spec.HostConfig.LogConfig.Type === "none",
    );
    assert(
      spec.HostConfig.ReadonlyRootfs &&
        !spec.HostConfig.Privileged &&
        spec.HostConfig.MemorySwap === spec.HostConfig.Memory,
    );
    assert(
      !spec.HostConfig.PublishAllPorts &&
        !Object.keys(spec.HostConfig.PortBindings ?? {}).length &&
        !spec.Mounts.length,
    );
    docker("start", id);

    const users = ["10000000-0000-0000-0000-000000000001", "10000000-0000-0000-0000-000000000002"];
    let anonymous;
    for (let i = 0; i < 12; i++) {
      try {
        const result = request(database, "select=owner_id");
        if (["200", "401", "403"].includes(result.status)) {
          anonymous = result;
          break;
        }
      } catch {
        // A bounded readiness wait only. All access assertions run once.
      }
      await delay(500);
    }
    assert(
      anonymous &&
        (["401", "403"].includes(anonymous.status) ||
          (Array.isArray(anonymous.rows) && anonymous.rows.length === 0)),
    );
    for (const [index, owner] of users.entries()) {
      const token = jwt(key, owner);
      const own = request(database, "select=owner_id&owner_id=eq." + owner, token);
      const other = request(database, "select=owner_id&owner_id=eq." + users[1 - index], token);
      assert(own.status === "200" && own.rows.length === 1 && own.rows[0].owner_id === owner);
      assert(other.status === "200" && Array.isArray(other.rows) && other.rows.length === 0);
    }
  }
  return {
    docker,
    tryDocker,
    inventory,
    verifyDatabase,
    removeSidecar,
    waitForDatabase,
    testRealPostgrest,
  };
}

async function main() {
  const [
    entry,
    sessionId,
    packageId,
    handoff,
    index,
    manifest,
    platform,
    context,
    endpoint,
    image,
    kind,
    unexpected,
  ] = process.argv.slice(2);
  const guid = /^[0-9a-f]{32}$/;
  const digest = /^sha256:[0-9a-f]{64}$/;
  const expected = fileURLToPath(new URL("../../atlas-recovery.ps1", import.meta.url));
  requireContract(!unexpected && entry && resolve(entry) === resolve(expected));
  requireContract(guid.test(handoff));
  requireContract(
    (kind === "ram" && sessionId === "-" && packageId === "-") ||
      (kind === "persistent" && guid.test(sessionId) && guid.test(packageId)),
  );
  requireContract(digest.test(index) && digest.test(manifest) && platform === "linux/amd64");
  requireContract(
    context === "desktop-linux" && endpoint === "npipe:////./pipe/dockerDesktopLinuxEngine",
  );
  const harness = createHarness(handoff, context, "atlas-recovery-postgrest-");
  const { docker, inventory } = harness;
  function verifyRecoveryImage(database) {
    const state = JSON.parse(docker("container", "inspect", "--format", "{{json .}}", database));
    const descriptor = state.ImageManifestDescriptor;
    requireContract(
      state.Image === index &&
        state.Config.Image === "docker.io/supabase/postgres@" + index &&
        descriptor?.digest === manifest &&
        descriptor.platform?.os + "/" + descriptor.platform?.architecture === platform &&
        !descriptor.platform?.variant,
    );
  }
  requireContract(
    docker("context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}") === endpoint,
  );
  const before = inventory();
  const cached = harness.tryDocker("image", "inspect", image, "--format", "{{json .}}");
  requireContract(cached);
  const meta = JSON.parse(cached);
  requireContract(
    /^sha256:[a-f0-9]{64}$/.test(meta.Id) && !Object.keys(meta.Config.Volumes ?? {}).length,
  );
  const powershell = resolve(
    process.env.SystemRoot ?? "",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  requireContract(basename(powershell) === "powershell.exe" && /^[A-Za-z]:[\\/]/.test(powershell));
  const command =
    kind === "ram"
      ? ["-Mode", "Compatibility"]
      : ["-Mode", "Restore", "-SessionId", sessionId, "-PackageId", packageId];
  const child = spawn(
    powershell,
    ["-NoProfile", "-NonInteractive", "-File", entry, ...command, "-PostgrestSession", handoff],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  const exit = new Promise((done) => {
    child.once("error", () => done(1));
    child.once("close", done);
  });
  let stdout = "";
  let overflow = false;
  let stderrPresent = false;
  child.stdout.on("data", (data) => {
    if (stdout.length + data.length > 1024) {
      overflow = true;
      return;
    }
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    if (data.toString().trim()) stderrPresent = true;
  });

  let database;
  let accepted = false;
  try {
    database = await harness.waitForDatabase(child);
    verifyRecoveryImage(database);
    await harness.testRealPostgrest(database, meta.Id);
    accepted = true;
  } finally {
    // The fixture only resumes after the namespace-sharing sidecar is gone.
    // Without this signal the pinned bounded watch fails and v6 cleans up.
    try {
      harness.removeSidecar();
      if (database) {
        harness.verifyDatabase(database);
        verifyRecoveryImage(database);
        docker("exec", database, "touch", "/tmp/prototype-postgrest-done");
      }
    } finally {
      const status = await exit;
      requireContract(inventory() === before && status === 0 && !stderrPresent && !overflow);
    }
  }
  const proof = stdout.trim();
  requireContract(accepted);
  if (kind === "ram") {
    requireContract(proof === "PASS class=legacy_compatibility");
    console.log("PASS class=postgrest_recovered_database");
  } else {
    requireContract(/^PASS class=restored pid=[0-9]+ restore_ms=[0-9]{1,9}$/.test(proof));
    console.log(proof);
  }
}

try {
  await main();
} catch {
  console.log("BLOCKED class=postgrest_recovered_database");
  process.exitCode = 1;
}
