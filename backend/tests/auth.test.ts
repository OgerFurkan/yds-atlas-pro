import { expect, spyOn, test } from "bun:test";
import { authenticate } from "../src/shared/supabase";
import { readConfig } from "../src/config/env";
const config = readConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-public",
});
const alice = "11111111-1111-4111-8111-111111111111";
test("server ownership comes from Supabase's verified user, not the client header", async () => {
  const mock = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      id: alice,
      aud: "authenticated",
      role: "authenticated",
      email: "alice@example.com",
      app_metadata: {},
      user_metadata: {},
    }),
  );
  try {
    const context = await authenticate(
      new Request("http://localhost/api/words", {
        headers: { Authorization: "Bearer server-verified-token", "x-user-id": "someone-else" },
      }),
      config,
    );
    expect(context.userId).toBe(alice);
    expect(String(mock.mock.calls[0][0])).toContain("/auth/v1/user");
    expect(new Headers(mock.mock.calls[0][1]?.headers).get("Authorization")).toBe(
      "Bearer server-verified-token",
    );
  } finally {
    mock.mockRestore();
  }
});
test("Supabase rejects a forged or expired bearer token before data access", async () => {
  const mock = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ msg: "Invalid JWT", code: "bad_jwt" }, { status: 401 }),
  );
  try {
    await expect(
      authenticate(
        new Request("http://localhost/api/words", {
          headers: { Authorization: "Bearer forged-token" },
        }),
        config,
      ),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  } finally {
    mock.mockRestore();
  }
});
