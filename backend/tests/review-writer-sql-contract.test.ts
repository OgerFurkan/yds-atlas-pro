import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Static checks are guardrails, not substitutes for transactional DB integration tests.
const sql = readFileSync(resolve(import.meta.dir, "../../docs/architecture/phase4b-v3-atomic-completion-DRAFT.sql"), "utf8");
test("v3 SQL is additive and runs as an invoker with service-role-only EXECUTE", () => {
  expect(sql).toContain("create or replace function public.complete_learning_session_v3(");
  expect(sql).toContain("security invoker");
  expect(sql).not.toMatch(/security definer/i);
  expect(sql).toContain("from public,anon,authenticated;");
  expect(sql).toContain("to service_role;");
  expect(sql).not.toMatch(/drop\s+function/i);
});
test("v3 SQL uses session lock, revision CAS, owner-scoped words and results ledger", () => {
  expect(sql).toContain("where id = p_id and user_id = p_owner_id for update;");
  expect(sql).toContain("if task.revision <> p_expected_revision then");
  expect(sql).toContain("where w.user_id = p_owner_id");
  expect(sql).toContain("insert into public.learning_results(session_id,user_id,scores)");
  expect(sql).toContain("on conflict(user_id,word_id) do update set");
});
test("review and scores are both verified against the stored task snapshot", () => {
  expect(sql).toContain("v_score is distinct from v_expected_score");
  expect(sql).toContain("v_rating is distinct from v_expected_rating");
  expect(sql).toContain("if v_version = 3 then");
  expect(sql).toContain("snapshot = jsonb_set(snapshot,'{saved}','true'::jsonb)");
});
