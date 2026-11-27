import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { mockOrigin } from "./config/playwright/loopback.js";
import { assertPublicEnvironment } from "./config/public-env.js";

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const localFixtures = command === "serve" && mode === "local-fixtures";
  const contract = mode === "local-contract";
  const testMode = localFixtures || contract || mode === "local-e2e" || mode === "local-dev";
  if (!testMode) {
    const publicEnv = loadEnv(mode, fileURLToPath(new URL("./", import.meta.url)), "VITE_");
    if (
      command === "build" &&
      process.env.VERCEL_ENV &&
      !["pre", "prod"].includes(publicEnv.VITE_ATLAS_ENV)
    )
      throw new Error("Hosted builds require explicit VITE_ATLAS_ENV.");
    assertPublicEnvironment({
      ...publicEnv,
      ATLAS_HOSTED_IDENTITIES: process.env.ATLAS_HOSTED_IDENTITIES,
    });
  }
  const proxyTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000";
  if (command === "serve" && !testMode) {
    const proxy = new URL(proxyTarget);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(proxy.hostname) ||
      proxy.href !== proxy.origin + "/" ||
      !/^https?:$/.test(proxy.protocol)
    )
      throw new Error("API_PROXY_TARGET must be a loopback origin.");
  }
  return {
    cacheDir: process.env.VITE_TEST_CACHE_DIR ?? "node_modules/.vite",
    envDir: testMode ? false : undefined,
    envPrefix: testMode ? [] : "VITE_",
    define: contract
      ? {
          "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(mockOrigin),
          "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
            "sb_publishable_contract_test",
          ),
          "import.meta.env.VITE_FEEDBACK_INSPECTOR_UI_ENABLED": JSON.stringify("true"),
        }
      : undefined,
    plugins: [
      react(),
      tailwindcss(),
      (contract || mode === "local-e2e") && {
        name: "atlas-loopback-preview",
        configurePreviewServer(server) {
          server.middlewares.use((request, _response, next) => {
            // Keep local Chromium asset transfers out of the streaming compressor.
            delete request.headers["accept-encoding"];
            next();
          });
        },
      },
      localFixtures && {
        name: "atlas-local-fixtures",
        async configureServer(server) {
          const path = fileURLToPath(
            new URL("../tests/frontend/fixtures/day-study-words.ts", import.meta.url),
          ).replaceAll("\\", "/");
          const { readyDayWords, partiallyLearnedDayWords, incompleteDayWords } =
            (await server.ssrLoadModule(`/@fs/${path}`)) as {
              readyDayWords: object[];
              partiallyLearnedDayWords: object[];
              incompleteDayWords: object[];
            };
          const headwords = [
            { word: "Notice", partOfSpeech: "Verb", cefr: "B1" },
            { word: "Accurate", partOfSpeech: "Adjective", cefr: "B2" },
            { word: "Resource", partOfSpeech: "Noun", cefr: "B1" },
            { word: "Recover", partOfSpeech: "Verb", cefr: "B2" },
          ];
          const incomplete = incompleteDayWords.map((word, index) => ({
            ...word,
            ...headwords[index],
            usageNote: "",
          }));
          server.middlewares.use("/__atlas_local_fixtures", (request, response) => {
            const variant = new URL(request.url ?? "/", "http://localhost").searchParams.get(
              "variant",
            );
            const deck = variant === "partial" ? partiallyLearnedDayWords : readyDayWords;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            response.end(JSON.stringify([deck, incomplete]));
          });
        },
      },
    ],
    // The dictionary runs in a lazily started worker. Pre-bundle its CJS import
    // before the first check so Vite doesn't reload an in-progress tutorial.
    optimizeDeps: { include: ["nspell"] },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: "react-vendor", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      headers: localFixtures
        ? { "Content-Security-Policy": "connect-src 'self' ws://127.0.0.1:* ws://localhost:*" }
        : undefined,
      fs: {
        allow: ["./", "../packages", "../node_modules"].map((path) =>
          fileURLToPath(new URL(path, import.meta.url)),
        ),
      },
      proxy: testMode
        ? undefined
        : {
            "/api": proxyTarget,
          },
    },
  };
});
