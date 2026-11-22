// Fail-closed LOCAL Supabase target validation, reusable for negative tests.
export function assertLocalSupabaseTarget(raw) {
  const target = new URL(raw);
  if (
    !["http://127.0.0.1:54321", "http://localhost:54321"].includes(target.origin) ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  ) {
    throw new Error("BLOCKED: only LOCAL Supabase loopback:54321 is permitted");
  }
  return target;
}
