import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { assertPublicEnvironment } from "./config/public-env.js";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  assertPublicEnvironment(loadEnv(mode, fileURLToPath(new URL("./", import.meta.url)), "VITE_"));
  return {
    cacheDir: process.env.VITE_TEST_CACHE_DIR ?? "node_modules/.vite",
    plugins: [react(), tailwindcss()],
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
      fs: {
        allow: ["./", "../packages", "../node_modules"].map((path) =>
          fileURLToPath(new URL(path, import.meta.url)),
        ),
      },
      proxy: {
        "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
      },
    },
  };
});
