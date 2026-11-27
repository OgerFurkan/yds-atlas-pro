import { importDestination, sourceSpecifiers } from "./shared-imports.mjs";

// Feature owners publish specific capabilities to named consumers. Local files stay private.
const publicEntries = {
  "backend/feedback": ["backend/ai/gemini", "backend/ai/gemini-keys", "backend/ai/gemini-request"],
  "backend/learning": ["backend/feedback/inspector-service", "backend/words/word-service"],
  "backend/lexicon": ["backend/words/word-service"],
  "backend/operations": ["backend/ai/gemini-keys"],
  "frontend/account": [
    "frontend/learning-game/task-storage",
    "frontend/word-library/api/local-word-repository",
    "frontend/word-library/api/word-api",
    "frontend/word-library/hooks/use-word-library",
  ],
  "frontend/dashboard": ["frontend/word-library/components/word-status"],
  "frontend/learning-game": [
    "frontend/word-library/api/ai-word-api",
    "frontend/word-library/library-storage",
    "frontend/word-library/components/ai-fill-progress",
    "frontend/word-library/components/word-import-review",
    "frontend/word-library/model/daily-groups",
    "frontend/word-library/model/prepare-word-inputs",
    "frontend/word-library/model/tiered-examples",
    "frontend/word-library/model/word-normalization",
  ],
  "frontend/word-library": [
    "frontend/learning-game/components/matching-panel",
    "frontend/learning-game/model/game-engine",
    "frontend/learning-game/model/game-session",
    "frontend/learning-game/task-storage",
    "frontend/learning-game/model/guest-result",
    "frontend/learning-game/model/matching-engine",
    "frontend/word-inspector/api/word-inspector-api",
  ],
};

const featurePath = /^(frontend|backend)\/src\/features\/([^/]+)\//;

export function featureDependencies(file, code) {
  const owner = featurePath.exec(file);
  if (!owner) return [];
  const consumer = owner[1] + "/" + owner[2];
  return sourceSpecifiers(file, code).flatMap((spec) => {
    const destination = importDestination(file, spec)?.split(/[?#]/, 1)[0];
    const target = featurePath.exec(destination ?? "");
    if (!target || (owner[1] === target[1] && owner[2] === target[2])) return [];
    const entry =
      target[1] +
      "/" +
      target[2] +
      "/" +
      destination.slice(target[0].length).replace(/\.[cm]?[jt]sx?$/, "");
    return [{ consumer, entry, allowed: publicEntries[consumer]?.includes(entry) === true }];
  });
}

export function generatedPaths(files) {
  return files.filter((file) =>
    /(?:^|\/)(?:\.artifacts|node_modules|dist|coverage|test-results(?:-[^/]*)?|playwright-report|__pycache__|\.cache)(?:\/|$)|\.(?:bak|zip|patch|pyc|tsbuildinfo|tmp|log|swp)$/i.test(
      file,
    ),
  );
}

const rootFiles = new Set([
  ".dockerignore",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".node-version",
  ".oxlintrc.json",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "README.md",
  "biome.json",
  "bun.lock",
  "package.json",
  "render.yaml",
  "vercel.json",
]);
const sourceTest = /\.(?:spec|test)\.[cm]?[jt]sx?$/i;
export function misplacedSources(files) {
  return files.filter((file) => {
    if (!file.includes("/")) return !rootFiles.has(file);
    if ((sourceTest.test(file) || /(?:^|\/)fixtures\//.test(file)) && !file.startsWith("tests/"))
      return true;
    if (file.startsWith("frontend/"))
      return !/^frontend\/(?:src\/|public\/|config\/(?:playwright\/|public-env\.ts$)|(?:index\.html|components\.json|vite\.config\.ts|tsconfig(?:\.(?:node|app))?\.json|package\.json|\.env\.example)$)/.test(
        file,
      );
    if (file.startsWith("backend/"))
      return !/^backend\/(?:src\/|(?:Dockerfile|tsconfig\.json|package\.json|\.env\.example)$)/.test(
        file,
      );
    if (file.startsWith("packages/"))
      return !/^packages\/[^/]+\/(?:src\/|(?:package\.json|tsconfig\.json|README\.md)$)/.test(file);
    if (file.startsWith("tests/"))
      return !/^tests\/(?:frontend\/|backend\/|(?:README|inventory)\.md$)/.test(file);
    return !/^(?:docs\/|scripts\/quality\/|supabase\/(?:migrations\/|config\.toml$)|\.github\/workflows\/|\.continue\/(?:prompts|rules)\/|\.vscode\/)/.test(
      file,
    );
  });
}

const largeModules = {
  "frontend/src/shared/i18n/locales/en/vocabulary.ts": [
    359,
    "English vocabulary keys are reviewed with the corresponding Turkish dictionary.",
  ],
  "frontend/src/shared/i18n/locales/tr/vocabulary.ts": [
    360,
    "Turkish vocabulary keys are reviewed with the corresponding English dictionary.",
  ],
};

export function largeFileReview(file, lines) {
  if (lines <= 350) return null;
  const record = largeModules[file];
  return {
    path: file,
    lines,
    review: record?.[1] ?? "Review responsibilities and document a cohesive reason.",
    baseline: record?.[0] ?? null,
    violation: !record || lines > record[0],
  };
}
