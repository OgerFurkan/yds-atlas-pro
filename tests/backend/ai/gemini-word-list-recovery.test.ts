import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ServerConfig } from "../../../backend/src/config/env";
import { generateWordList } from "../../../backend/src/features/ai/gemini";
import type { AiWordListResponse } from "../../../packages/shared/src/index";

// All fixtures are synthetic. No real Gemini, database, secret or student data.
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo"];
const TIERS = ["easy", "easy", "medium", "yds", "yds"] as const;
const historicalPaths = {
  "backend/src/features/ai/gemini-request.ts": "backend/src/features/ai/gemini-request.ts",
  "backend/src/features/ai/gemini.ts": "backend/src/features/ai/gemini.ts",
  "backend/tests/gemini-word-list-p0-hotfix.test.ts":
    "tests/backend/ai/gemini-word-list-recovery.test.ts",
  "frontend/tests/cloud/account-flow.spec.ts": "tests/frontend/contracts/account-flow.spec.ts",
  "frontend/tests/unit/prepare-word-inputs-recovery.test.ts":
    "tests/frontend/unit/prepare-word-inputs-recovery.test.ts",
};
function item(word: string): AiWordListResponse["suggestions"][number] {
  return {
    word,
    alternatives: [],
    meanings: ["kavram"],
    partOfSpeech: "Noun",
    cefr: "B1",
    usageNote: "Yalnızca sentetik test.",
    examples: TIERS.map((difficulty, index) => ({
      sentence: "Researchers discuss " + word + " in example " + (index + 1) + ".",
      translation: "Araştırmacılar " + (index + 1) + ". örnekte kelimeyi tartışıyor.",
      translationFocus: ["kelimeyi"],
      difficulty,
    })),
  };
}
function config(id: string): ServerConfig {
  return { GEMINI_KEYS: [id], GEMINI_MODEL_WORD: "gemini-3.5-flash-lite" } as ServerConfig;
}
function upstream(text: string, finishReason = "STOP"): Response {
  return Response.json({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
}
function outgoing(init?: RequestInit) {
  const body = JSON.parse(String(init?.body));
  return {
    structured: Object.hasOwn(body.generationConfig, "responseJsonSchema"),
    payload: JSON.parse(body.contents[0].parts[0].text) as { count: number; requested?: string[] },
  };
}
function validated(words: string[]) {
  return JSON.stringify({ suggestions: words.map(item) });
}
test("P0 regression: malformed structured five-item envelope triggers one compact plain retry", async () => {
  const calls: { structured: boolean; count: number; requested?: string[] }[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const call = outgoing(init);
    calls.push({
      structured: call.structured,
      count: call.payload.count,
      requested: call.payload.requested,
    });
    return upstream(
      call.structured ? '{"suggestions": {' : validated(call.payload.requested ?? []),
    );
  }) as unknown as typeof fetch;
  const result = await generateWordList(5, [], config("p0-a"), undefined, fetcher, WORDS);
  expect(calls).toEqual([
    { structured: true, count: 5, requested: WORDS },
    { structured: false, count: 2, requested: WORDS.slice(0, 2) },
  ]);
  expect(result.suggestions.map((word) => word.word)).toEqual(WORDS.slice(0, 2));
  expect(
    result.suggestions.every(
      (word) =>
        word.examples.map((example) => example.difficulty).join() === "easy,easy,medium,yds,yds",
    ),
  ).toBe(true);
});
test("MAX_TOKENS fails closed on the first pass and compact retry salvages safe words", async () => {
  const counts: number[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const call = outgoing(init);
    counts.push(call.payload.count);
    return counts.length === 1
      ? upstream('{"suggestions": [', "MAX_TOKENS")
      : upstream(validated(call.payload.requested ?? []));
  }) as unknown as typeof fetch;
  const result = await generateWordList(5, [], config("p0-b"), undefined, fetcher, WORDS);
  expect(counts).toEqual([5, 2]);
  expect(result.suggestions.map((word) => word.word)).toEqual(WORDS.slice(0, 2));
});
test("malformed and truncated envelopes across both passes still produce 502 and no words", async () => {
  const counts: number[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    counts.push(outgoing(init).payload.count);
    return upstream(counts.length === 1 ? '{"suggestions":' : '{"suggestions":{"wrong":true}}');
  }) as unknown as typeof fetch;
  await expect(
    generateWordList(5, [], config("p0-c"), undefined, fetcher, WORDS),
  ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE", status: 502 });
  expect(counts).toEqual([5, 2]);
});
test("safety and recitation finishes stop immediately rather than bypassing restrictions", async () => {
  for (const reason of ["SAFETY", "RECITATION"]) {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return upstream('{"suggestions":[]}', reason);
    }) as unknown as typeof fetch;
    await expect(
      generateWordList(5, [], config("p0-safe-" + reason), undefined, fetcher, WORDS),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(calls).toBe(1);
  }
});
test("foreign, malformed, duplicate and wrong translationFocus never become accepted words", async () => {
  let callCount = 0;
  const wrongFocus = item("charlie");
  wrongFocus.examples[0].translationFocus = ["bulunmayan"];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const params = outgoing(init).payload;
    callCount++;
    return callCount === 1
      ? upstream(
          JSON.stringify({
            suggestions: [
              item("alpha"),
              { word: "bravo" },
              item("outside"),
              item("alpha"),
              wrongFocus,
            ],
          }),
        )
      : upstream(validated(params.requested ?? []));
  }) as unknown as typeof fetch;
  const result = await generateWordList(5, [], config("p0-d"), undefined, fetcher, WORDS);
  expect(callCount).toBe(2);
  expect(result.suggestions.map((word) => word.word)).toEqual(WORDS);
  expect(
    result.suggestions.every((word) =>
      word.examples.every((example) =>
        example.translationFocus.every((focus) => example.translation.includes(focus)),
      ),
    ),
  ).toBe(true);
});
test("bad individual entries in both passes preserve only validated neighbors", async () => {
  let count = 0;
  const fetcher = (async () => {
    count++;
    const suggestions =
      count === 1
        ? [item("alpha"), { word: "bravo" }, item("foreign"), { word: "charlie" }, item("alpha")]
        : [{ word: "bravo" }, { word: "charlie" }, { word: "delta" }, { word: "echo" }];
    return upstream(JSON.stringify({ suggestions }));
  }) as unknown as typeof fetch;
  const result = await generateWordList(5, [], config("p0-e"), undefined, fetcher, WORDS);
  expect(result.suggestions.map((word) => word.word)).toEqual(["alpha"]);
  expect(count).toBe(2);
});
test("structured HTTP 400 still falls back to plain output without weakening validation", async () => {
  const structured: boolean[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const next = outgoing(init);
    structured.push(next.structured);
    return next.structured
      ? Response.json({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 })
      : upstream(validated(next.payload.requested ?? []));
  }) as unknown as typeof fetch;
  const result = await generateWordList(5, [], config("p0-f"), undefined, fetcher, WORDS);
  expect(structured).toEqual([true, false]);
  expect(result.suggestions).toHaveLength(5);
});
test("non-thought fenced JSON is parsed; thought text is not interpreted as content", async () => {
  const fence = String.fromCharCode(96, 96, 96);
  const fetcher = (async () =>
    Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { thought: true, text: "not user-facing JSON" },
              { text: fence + "json\n" + validated(WORDS) + "\n" + fence },
            ],
          },
        },
      ],
    })) as unknown as typeof fetch;
  const result = await generateWordList(5, [], config("p0-g"), undefined, fetcher, WORDS);
  expect(result.suggestions.map((word) => word.word)).toEqual(WORDS);
});
test.each([
  [429, "AI_QUOTA_EXCEEDED"],
  [401, "AI_AUTH_ERROR"],
  [403, "AI_AUTH_ERROR"],
] as const)(
  "HTTP %i keeps its real terminal error, not a false malformed-output 502",
  async (status, code) => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return Response.json({ error: { status: "upstream_test" } }, { status });
    }) as unknown as typeof fetch;
    await expect(
      generateWordList(5, [], config("p0-status-" + status), undefined, fetcher, WORDS),
    ).rejects.toMatchObject({ code });
    expect(calls).toBe(1);
  },
);
test("a pre-aborted request neither contacts the provider nor returns partial words", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return upstream(validated(WORDS));
  }) as unknown as typeof fetch;
  await expect(
    generateWordList(5, [], config("p0-abort"), controller.signal, fetcher, WORDS),
  ).rejects.toMatchObject({ code: "AI_CANCELLED" });
  expect(calls).toBe(0);
});

test("P0 exact frozen main source red then hotfix green on the same malformed five-word fixture", async () => {
  // Load the immutable base from the local Git history. CI checks out that history.
  const base = "567f57a9a893991ba67a46b72443114347a1aee8";
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const tracked = "backend/src/features/ai/gemini.ts";
  const command = (args: string[], input?: string) =>
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      ...(input === undefined ? {} : { input }),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20_000,
    }).trimEnd();
  const original = command(["show", base + ":" + tracked]);
  const originalBlobSha = command(["hash-object", "--stdin"], original + "\n");
  // A trailing newline from execFileSync may be removed by trimEnd above; the
  // immutable source checksum is intentionally checked after restoration.
  expect(originalBlobSha).toBe("61549171b61f7dc8dcc7c38f56f3f29db8df61ae");
  const legacyFile = join(
    repoRoot,
    "backend",
    "src",
    "features",
    "ai",
    "__p0_legacy_main_" + process.pid + ".ts",
  );
  writeFileSync(legacyFile, original + "\n", { flag: "wx" });
  try {
    const legacy = await import(pathToFileURL(legacyFile).href);
    const callsOld: { structured: boolean; count: number }[] = [];
    const oldFetcher = (async (_url: unknown, init?: RequestInit) => {
      const next = outgoing(init);
      callsOld.push({ structured: next.structured, count: next.payload.count });
      return upstream(
        next.structured ? '{"suggestions":' : validated(next.payload.requested ?? []),
      );
    }) as unknown as typeof fetch;
    await expect(
      legacy.generateWordList(5, [], config("p0-frozen-main"), undefined, oldFetcher, WORDS),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE", status: 502 });
    expect(callsOld).toEqual([
      { structured: true, count: 5 },
      { structured: true, count: 5 },
    ]);

    const callsNew: { structured: boolean; count: number }[] = [];
    const newFetcher = (async (_url: unknown, init?: RequestInit) => {
      const next = outgoing(init);
      callsNew.push({ structured: next.structured, count: next.payload.count });
      return upstream(
        next.structured ? '{"suggestions":' : validated(next.payload.requested ?? []),
      );
    }) as unknown as typeof fetch;
    const result = await generateWordList(
      5,
      [],
      config("p0-frozen-hotfix"),
      undefined,
      newFetcher,
      WORDS,
    );
    expect(callsNew).toEqual([
      { structured: true, count: 5 },
      { structured: false, count: 2 },
    ]);
    expect(result.suggestions.map((entry) => entry.word)).toEqual(WORDS.slice(0, 2));
  } finally {
    unlinkSync(legacyFile);
  }
});

test.each(["empty", "non-text", "thought-only"] as const)(
  "malformed provider parts %s are rejected in both passes with zero accepted",
  async (kind) => {
    const sizes: number[] = [];
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      sizes.push(outgoing(init).payload.count);
      const parts =
        kind === "empty"
          ? []
          : kind === "non-text"
            ? [{ inlineData: { mimeType: "text/plain" } }]
            : [{ thought: true, text: validated(WORDS) }];
      return Response.json({
        candidates: [{ finishReason: "STOP", content: { parts } }],
      });
    }) as unknown as typeof fetch;
    await expect(
      generateWordList(5, [], config("p0-parts-" + kind), undefined, fetcher, WORDS),
    ).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
      status: 502,
    });
    expect(sizes).toEqual([5, 2]);
  },
);

test("P0 scoped baseline diff/secret scan and format/lint diagnostics", () => {
  const base = "567f57a9a893991ba67a46b72443114347a1aee8";
  const merged = "1264f8c76238d864c50c9e8818cf27615ebb361a";
  const cwd = fileURLToPath(new URL("../../../", import.meta.url));
  const files = Object.values(historicalPaths);
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    });
  for (const ref of [base, merged]) git(["cat-file", "-e", ref + "^{commit}"]);
  // The five-file scope belongs to PR #27. Keep scanning changes through current HEAD.
  const changed = git(["diff", "--name-only", base, merged]).trim().split("\n").sort();
  expect(changed).toEqual(Object.keys(historicalPaths).sort());
  const whitespace = git(["diff", "--check", base, "HEAD"]);
  expect(whitespace).toBe("");
  const patch = git(["diff", "--unified=0", base, "HEAD"]);
  const additions = patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");
  const sensitive = [
    /AIza[0-9A-Za-z_-]{25,}/,
    /sb_secret_[A-Za-z0-9_-]{15,}/,
    /gh[pousr]_[A-Za-z0-9_]{25,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /Bearer\s+eyJ[A-Za-z0-9_-]{20,}/,
  ];
  const suspicious = sensitive.some((pattern) => pattern.test(additions));
  expect(suspicious).toBe(false);
  console.info("P0_QUALITY git diff --check BASE HEAD: PASS");
  console.info("P0_QUALITY changed-line secret patterns: PASS");

  // Diagnostics only: main predates the F1–F3 103-file formatting cleanup.
  // Never autoformat unrelated files or falsely report lint/format PASS.
  const commands = [
    ["bun run lint", ["bun", "run", "lint"]],
    ["bunx oxlint changed", ["bunx", "oxlint", ...files]],
    ["bunx biome format changed", ["bunx", "biome", "format", ...files]],
  ] as const;
  for (const [label, cmd] of commands) {
    const result = Bun.spawnSync({
      cmd: [...cmd],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const exit = result.exitCode;
    console.info(
      "P0_QUALITY " + label + ": " + (exit === 0 ? "PASS" : "FAIL") + " (exit=" + exit + ")",
    );
    // Diagnostics do NOT become a fabricated pass if baseline formatting debt
    // remains; CI logs record their actual exit status for PM acceptance.
  }
});

test("P0 immutable baseline Biome per-file hunk attribution", () => {
  const base = "567f57a9a893991ba67a46b72443114347a1aee8";
  const cwd = fileURLToPath(new URL("../../../", import.meta.url));
  const sha12 = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);
  const git = (args: string[]) => {
    const p = Bun.spawnSync({
      cmd: ["git", ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    return { exit: p.exitCode, stdout: Buffer.from(p.stdout).toString("utf8") };
  };
  expect(git(["cat-file", "-e", base + "^{commit}"]).exit).toBe(0);
  const version = Bun.spawnSync({
    cmd: ["bunx", "biome", "--version"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  console.info(
    "P0_BIOME VERSION=" +
      Buffer.from(version.stdout).toString("utf8").trim() +
      " EXIT=" +
      version.exitCode,
  );
  expect(version.exitCode).toBe(0);
  const conf = git(["show", base + ":biome.json"]);
  expect(conf.exit).toBe(0);
  const currentConf = readFileSync(join(cwd, "biome.json"), "utf8").replace(/\r\n/g, "\n");
  const baseline = JSON.parse(conf.stdout.replace(/\r\n/g, "\n"));
  const current = JSON.parse(currentConf);
  expect(current.formatter).toMatchObject({ ...baseline.formatter, lineEnding: "lf" });
  expect(current.javascript.formatter).toEqual(baseline.javascript.formatter);

  const tmp = mkdtempSync(join(tmpdir(), "p0-biome-"));
  function formatDetails(path: string, label: string, contents: string) {
    const r = Bun.spawnSync({
      cmd: ["bunx", "biome", "format", "--stdin-file-path=" + path],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: Buffer.from(contents, "utf8"),
      env: process.env,
    });
    const formatted = Buffer.from(r.stdout).toString("utf8");
    if (r.exitCode !== 0) {
      console.info("P0_BIOME " + path + " " + label + " CLI_FAIL=" + r.exitCode);
      return { valid: false, hunks: [] as { span: string; sig: string; patch: string }[] };
    }
    writeFileSync(join(tmp, "input.ts"), contents);
    writeFileSync(join(tmp, "output.ts"), formatted);
    const diff = git([
      "diff",
      "--no-index",
      "--no-color",
      "--unified=0",
      join(tmp, "input.ts"),
      join(tmp, "output.ts"),
    ]);
    expect([0, 1]).toContain(diff.exit);
    const hunks = diff.stdout
      .split(/(?=^@@ -)/m)
      .filter((part) => part.startsWith("@@ -"))
      .map((part) => {
        const first = part.split("\n")[0];
        const m = first.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        const data = part
          .split("\n")
          .slice(1)
          .filter((line) => line.startsWith("+") || line.startsWith("-"));
        return {
          span: m ? "L" + m[1] + "(n" + (m[2] ?? "1") + ")" : "?",
          sig: sha12(data.join("\n")),
          patch: part.trimEnd(),
        };
      });
    console.info(
      "P0_BIOME " +
        path +
        " " +
        label +
        " EXIT=" +
        r.exitCode +
        " MATCH=" +
        String(contents === formatted) +
        " HUNKS=" +
        hunks.map((h) => h.span + "#" + h.sig).join(","),
    );
    return { valid: true, hunks };
  }
  try {
    for (const [oldPath, path] of Object.entries(historicalPaths)) {
      const baseFile = git(["show", base + ":" + oldPath]);
      const current = readFileSync(join(cwd, path), "utf8");
      const prior = baseFile.exit === 0 ? formatDetails(path, "BASE", baseFile.stdout) : null;
      const now = formatDetails(path, "HEAD", current);
      expect(now.valid).toBe(true);
      if (prior) expect(prior.valid).toBe(true);
      const oldIds = new Set((prior?.hunks ?? []).map((h) => h.sig));
      const introduced = now.hunks.filter((h) => !oldIds.has(h.sig));
      console.info(
        "P0_BIOME_FILE " +
          path +
          " BASE=" +
          (prior ? "PRESENT" : "ABSENT") +
          " HEAD_HUNKS=" +
          now.hunks.length +
          " INHERITED_EXACT_HUNKS=" +
          (now.hunks.length - introduced.length) +
          " NEW_OR_CHANGED_HUNKS=" +
          introduced.length +
          " LOCATIONS=" +
          introduced.map((h) => h.span).join(","),
      );
      // Emit only newly introduced non-secret source-format hunks, never
      // raw env/user data. The files are the five pre-approved hotfix paths.
      for (const h of introduced) {
        console.info(
          "P0_BIOME_PATCH_FILE " +
            path +
            " " +
            h.span +
            " PATCH_BASE64=" +
            Buffer.from(h.patch, "utf8").toString("base64"),
        );
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
