import { createRequire } from "node:module";
import path from "node:path";

// Use the same TypeScript/TSX parser already installed with the web build.
const { parseSync } = createRequire(new URL("../../frontend/package.json", import.meta.url))(
  "vite",
);

export function importReferences(file, code) {
  const { program, errors } = parseSync(file, code);
  if (errors.length) throw new Error(`Cannot audit ${file}: ${errors[0].message}`);
  const references = [];

  function visit(node) {
    if (!node || typeof node !== "object") return;
    const source = node.source;
    const spec =
      source?.type === "TemplateLiteral" && source.expressions.length === 0
        ? source.quasis[0].value.cooked
        : source?.value;
    const lazy = node.type === "ImportExpression";
    const kinds = node.specifiers ?? [];
    const typeOnly =
      node.importKind === "type" ||
      node.exportKind === "type" ||
      node.type === "TSImportType" ||
      (kinds.length > 0 &&
        kinds.every(
          (specifier) => specifier.importKind === "type" || specifier.exportKind === "type",
        ));
    if (typeof spec === "string" || lazy)
      references.push({
        spec: typeof spec === "string" ? spec : null,
        typeOnly,
        lazy,
        offset: node.start,
      });

    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child?.type) visit(child);
    }
  }
  visit(program);
  return references;
}

export function sourceSpecifiers(file, code, runtimeOnly = false) {
  return importReferences(file, code).flatMap(({ spec, typeOnly, lazy }) =>
    spec !== null && (!runtimeOnly || (!typeOnly && !lazy)) ? [spec] : [],
  );
}

export function resolveSource(file, spec, names, exportsMap) {
  const clean = spec.split(/[?#]/, 1)[0];
  const destination = exportsMap.get(clean) ?? importDestination(file, clean);
  if (!destination) return undefined;
  const candidates = [destination];
  const stem = destination.replace(/\.[cm]?jsx?$/, "");
  const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
  for (const extension of extensions)
    candidates.push(stem + extension, destination + "/index" + extension);
  return candidates.find((candidate) => names.has(candidate));
}

export function importDestination(file, spec) {
  if (spec.startsWith("@/")) return path.posix.join("frontend/src", spec.slice(2));
  if (spec.startsWith(".")) return path.posix.join(path.posix.dirname(file), spec);
  return null;
}

export function forbiddenSharedImports(file, code) {
  return sourceSpecifiers(file, code).filter((spec) =>
    /^(?:frontend|backend)\/src\/(app|features)(?:[./?#]|$)/.test(
      importDestination(file, spec) ?? "",
    ),
  );
}

export function runtimeCycles(graph) {
  const finished = new Set();
  const ancestors = new Set();
  const stack = [];
  const cycles = [];
  function visit(file) {
    if (finished.has(file)) return;
    if (ancestors.has(file)) {
      cycles.push([...stack.slice(stack.indexOf(file)), file]);
      return;
    }
    stack.push(file);
    ancestors.add(file);
    for (const dep of graph.get(file) ?? []) visit(dep);
    stack.pop();
    ancestors.delete(file);
    finished.add(file);
  }
  for (const file of graph.keys()) visit(file);
  return cycles;
}

export function crossWorkspaceImports(file, code, sharedExports) {
  const workspace = file.startsWith("packages/shared/") ? "shared" : file.split("/")[0];
  return sourceSpecifiers(file, code).filter((spec) => {
    const destination = importDestination(file, spec) ?? spec;
    if (destination === "@yds-atlas/shared" || destination.startsWith("@yds-atlas/shared/")) {
      return workspace === "shared" || !sharedExports.has(destination);
    }
    if (destination.startsWith("packages/shared/")) return workspace !== "shared";
    if (/^(?:@yds-atlas\/)?(?:frontend|backend)(?:\/|$)/.test(destination))
      return workspace !== destination.replace(/^@yds-atlas\//, "").split("/")[0];
    return false;
  });
}
