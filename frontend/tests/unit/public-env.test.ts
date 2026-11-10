import { expect, test } from "bun:test";
import { assertPublicEnvironment } from "../../config/public-env";
test("build configuration refuses secret keys before Vite can embed them", () => {
  expect(() =>
    assertPublicEnvironment({ VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public" }),
  ).not.toThrow();
  expect(() => assertPublicEnvironment({})).not.toThrow();
  expect(() =>
    assertPublicEnvironment({ VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_private" }),
  ).toThrow();
  const token =
    "header." +
    Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url") +
    ".signature";
  expect(() => assertPublicEnvironment({ VITE_SUPABASE_ANON_KEY: token })).toThrow();
  expect(() => assertPublicEnvironment({ VITE_GEMINI_API_KEY: "private" })).toThrow();
});
