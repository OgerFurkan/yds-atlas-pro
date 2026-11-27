import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { run } from "node:test";
import { tap } from "node:test/reporters";

const [report, ...files] = process.argv.slice(2);
const expected = new Set(files.map((file) => resolve(file)));
const observed = new Map();
const stream = run({ files });
let failures = 0;
stream.on("data", ({ type, data }) => {
  if (type === "test:fail" || (type === "test:pass" && (data.skip || data.todo))) failures++;
  if (type !== "test:pass" || !data.line || !data.entryFile || !data.file || data.skip || data.todo)
    return;
  const file = resolve(data.entryFile);
  // File-level test placeholders do not prove a test was executed.
  if (data.details?.type === "suite" || !expected.has(file)) return;
  observed.set(file, (observed.get(file) ?? 0) + 1);
});
await pipeline(stream, tap, process.stdout);
writeFileSync(report, JSON.stringify([...observed.keys()]), { flag: "wx" });
if (failures || [...expected].some((file) => !observed.has(file))) process.exitCode = 1;
