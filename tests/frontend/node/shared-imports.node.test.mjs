import assert from "node:assert/strict";
import { test } from "node:test";
import {
  crossWorkspaceImports,
  forbiddenSharedImports,
} from "../../../scripts/quality/shared-imports.mjs";

test("shared boundaries resolve aliases, relative re-exports and literal dynamic imports", () => {
  const code = [
    'import type { Entry } from "@/features/words";',
    'export * from "../../app/shell";',
    "const load = () => import(`@/features/game`);",
    'type T = import("@/app").T;',
    'import "@/shared/ui/button";',
    '// import "@/features/comment";',
    "const example = \"import('@/app/example')\";",
  ].join("\n");
  assert.deepEqual(forbiddenSharedImports("frontend/src/shared/api/example.ts", code), [
    "@/features/words",
    "../../app/shell",
    "@/features/game",
    "@/app",
  ]);
});

test("workspace boundaries allow public shared contracts and reject direct server and private package imports", () => {
  const exports = new Map([["@yds-atlas/shared", "packages/shared/src/index.ts"]]);
  const code = [
    'import type { Word } from "@yds-atlas/shared";',
    'import "@yds-atlas/shared/private";',
    'export type { Db } from "../../../backend/src/shared/supabase";',
    'import "@yds-atlas/backend";',
    'import "../../../packages/shared/src/game-engine";',
  ].join("\n");
  assert.deepEqual(crossWorkspaceImports("frontend/src/features/game.ts", code, exports), [
    "@yds-atlas/shared/private",
    "../../../backend/src/shared/supabase",
    "@yds-atlas/backend",
    "../../../packages/shared/src/game-engine",
  ]);
  assert.deepEqual(
    crossWorkspaceImports(
      "packages/shared/src/domain.ts",
      'import "../../../frontend/src/app";',
      exports,
    ),
    ["../../../frontend/src/app"],
  );
});
