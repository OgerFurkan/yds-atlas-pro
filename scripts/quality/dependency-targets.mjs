/** Resolve frontend aliases and relative imports for architecture diagnostics. */
import path from "node:path";

export function targetForSharedImport(sourceFile, specifier, root) {
  const relative = path.relative(root, sourceFile).split(path.sep).join("/");
  if (!relative.startsWith("frontend/src/shared/")) return null;
  if (specifier.startsWith("@/")) return `frontend/src/${specifier.slice(2)}`;
  if (!specifier.startsWith(".")) return null;
  return path.relative(root, path.resolve(path.dirname(sourceFile), specifier)).split(path.sep).join("/");
}

export function isForbiddenSharedDependency(target) {
  return typeof target === "string" && /^frontend\/src\/(?:app|features)\//.test(target);
}
