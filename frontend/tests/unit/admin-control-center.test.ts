import { describe, expect, test } from "bun:test";
import { countExampleTiers, normalizeEditorialSearch, permittedEditorialActions, isCurrentEditorialDecision, resultForEditorialEntry, type EditorialDecision } from "../../src/features/admin/model/admin-editorial-model";
import { editorialListPath } from "../../src/features/admin/api/admin-editorial-api";

describe("F3b Admin UI pure model contracts", () => {
  test("normalizes English headword with safe whitespace", () => {
    expect(normalizeEditorialSearch("  ACQUIRE  ")).toBe("acquire");
    expect(normalizeEditorialSearch("Take   Off")).toBe("take off");
  });
  test("rejects paths, non-English query, long query", () => {
    expect(normalizeEditorialSearch("acquire/../../admin")).toBeNull();
    expect(normalizeEditorialSearch("⚠️")).toBeNull();
    expect(normalizeEditorialSearch("a".repeat(121))).toBeNull();
  });
  test("quarantine cannot approve, approved cannot reapprove", () => {
    expect(permittedEditorialActions({status:"quarantined",revision:2})).toEqual({approve:false,quarantine:false});
    expect(permittedEditorialActions({status:"human_reviewed",revision:2})).toEqual({approve:false,quarantine:true});
    expect(permittedEditorialActions({status:"machine_validated",revision:2})).toEqual({approve:true,quarantine:true});
  });
  test("rejects invalid revisions", () => {
    expect(permittedEditorialActions({status:"machine_validated",revision:0}).approve).toBe(false);
    expect(permittedEditorialActions({status:"machine_validated",revision:NaN}).approve).toBe(false);
  });
  test("five examples tier counts stay explicit", () => {
    expect(countExampleTiers([{difficulty:"easy"},{difficulty:"easy"},{difficulty:"medium"},{difficulty:"yds"},{difficulty:"yds"}])).toEqual({easy:2,medium:1,yds:2});
    expect(countExampleTiers([{difficulty:"unknown"}])).toEqual({easy:0,medium:0,yds:0});
  });
  test("server list URL is bounded and encoded", () => {
    const url = editorialListPath({status:"machine_validated",word:"take off",offset:20,limit:20});
    expect(url).toContain("word=take+off");
    expect(url).toContain("offset=20");
  });
  test("invalid pagination cannot be sent to admin API", () => {
    expect(() => editorialListPath({status:"all",word:"",offset:5001,limit:20})).toThrow();
    expect(() => editorialListPath({status:"all",word:"",offset:-1,limit:20})).toThrow();
  });
});


describe("F3c Admin UI decision identity and response attribution", () => {
  const identity = { id: "a1111111-1111-4111-8111-111111111111", revision: 4, word: "acquire" };
  const decision: EditorialDecision = { ...identity, nextStatus: "human_reviewed", reasonCode: "editorial_approved" };
  test("same record and revision allows reviewed decision", () => {
    expect(isCurrentEditorialDecision(decision, identity)).toBe(true);
  });
  test("switching to a different record rejects pending decision", () => {
    expect(isCurrentEditorialDecision(decision, { ...identity, id: "b2222222-2222-4222-8222-222222222222" })).toBe(false);
  });
  test("changed revision invalidates stale pending review", () => {
    expect(isCurrentEditorialDecision(decision, { ...identity, revision: 5 })).toBe(false);
  });
  test("word mutation also invalidates pending review", () => {
    expect(isCurrentEditorialDecision(decision, { ...identity, word: "acquired" })).toBe(false);
  });
  test("invalid and missing decision cannot be submitted", () => {
    expect(isCurrentEditorialDecision(null, identity)).toBe(false);
    expect(isCurrentEditorialDecision({ ...decision, revision: 0 }, identity)).toBe(false);
    expect(isCurrentEditorialDecision(decision, null)).toBe(false);
  });
  test("late result belongs only to its original entry", () => {
    const response = { id: identity.id, kind: "success" as const, message: "Onaylandı" };
    expect(resultForEditorialEntry(response, identity.id)).toEqual(response);
    expect(resultForEditorialEntry(response, "b2222222-2222-4222-8222-222222222222")).toBeNull();
  });
  test("no result stays hidden", () => {
    expect(resultForEditorialEntry(null, identity.id)).toBeNull();
  });
});
