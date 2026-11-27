import assert from "node:assert/strict";
import { test } from "node:test";
import {
  featureDependencies,
  generatedPaths,
  largeFileReview,
  misplacedSources,
} from "../../../scripts/quality/architecture-policy.mjs";
import {
  importReferences,
  resolveSource,
  runtimeCycles,
} from "../../../scripts/quality/shared-imports.mjs";

test("only named consumer features can use published feature entries", () => {
  const code = [
    'import "@/features/word-library/library-storage";',
    'export type { Item } from "../../word-library/model/not-public.js";',
    'const load = () => import("@/features/word-library/components/word-example-private");',
    'import "./own-view";',
  ].join("\n");
  const source = "frontend/src/features/learning-game/components/page.tsx";
  assert.deepEqual(
    featureDependencies(source, code).map(({ allowed }) => allowed),
    [true, false, false],
  );
  assert.equal(
    featureDependencies(source.replace("learning-game", "other"), code)[0].allowed,
    false,
  );
});

test("generated outputs violate tracked layout and oversized files surface for review", () => {
  const generated = [
    ".artifacts/quality/summary.json",
    "frontend/test-results-guest/run/trace.zip",
    "packages/shared/dist/index.js",
    "scripts/quality/__pycache__/file.pyc",
  ];
  assert.deepEqual(
    generatedPaths([...generated, "tests/backend/database/legacy-tooltip.fixture.sql"]),
    generated,
  );
  assert.deepEqual(
    misplacedSources([
      "frontend/playwright.cloud.config.ts",
      "backend/src/service.test.ts",
      "frontend/config/playwright/cloud.config.ts",
      "tests/backend/api/service.test.ts",
    ]),
    ["frontend/playwright.cloud.config.ts", "backend/src/service.test.ts"],
  );
  assert.equal(largeFileReview("feature.ts", 350), null);
  assert.equal(largeFileReview("feature.ts", 351).violation, true);
  const dictionary = "frontend/src/shared/i18n/locales/en/vocabulary.ts";
  assert.equal(largeFileReview(dictionary, 359).violation, false);
  assert.equal(largeFileReview(dictionary, 360).violation, true);
  assert.deepEqual(
    misplacedSources([
      "scratch.ts",
      "backend/config/temp.ts",
      "packages/shared/tests/case.ts",
      "backend/src/fixtures/seed.ts",
    ]),
    [
      "scratch.ts",
      "backend/config/temp.ts",
      "packages/shared/tests/case.ts",
      "backend/src/fixtures/seed.ts",
    ],
  );
});

test("runtime cycle detection allows sibling dependencies and identifies a closed loop", () => {
  const graph = new Map([
    ["page", ["model", "view"]],
    ["view", ["model"]],
    ["model", []],
  ]);
  assert.deepEqual(runtimeCycles(graph), []);
  graph.set("model", ["view"]);
  assert.deepEqual(runtimeCycles(graph), [["model", "view", "model"]]);
});

test("literal lazy imports resolve, computed loads are reported, and type-only imports stay out of eager edges", () => {
  const file = "frontend/src/app/App.tsx";
  const refs = importReferences(
    file,
    'import {type Entry} from "@/entry"; const load=()=>import("@/later.js"); const other=(id)=>import(id);',
  );
  assert.deepEqual(
    refs.map(({ spec, typeOnly, lazy }) => [spec, typeOnly, lazy]),
    [
      ["@/entry", true, false],
      ["@/later.js", false, true],
      [null, false, true],
    ],
  );
  assert.equal(
    resolveSource(file, refs[1].spec, new Set(["frontend/src/later.ts"]), new Map()),
    "frontend/src/later.ts",
  );
});
