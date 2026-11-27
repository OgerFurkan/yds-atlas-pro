import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { DailyWordGroupsRepository } from "../../../frontend/src/features/word-library/api/daily-word-groups-repository";
import {
  localWordRepository as library,
  MissingLocalWordsWithPlanSettings,
  recoverEmptyLibrary,
} from "../../../frontend/src/features/word-library/api/local-word-repository";
import { storageKeys as keys } from "../../../frontend/src/shared/lib/storage-keys";
import { installMemoryStorage } from "../helpers/memory-storage";

let fixture: ReturnType<typeof installMemoryStorage>;
beforeEach(() => {
  fixture = installMemoryStorage();
});
afterEach(() => fixture.restore());

for (const fault of ["json", "empty-text", "schema", "denied", "missing"] as const) {
  test(`a ${fault} library refuses reconciliation and all guest mutations`, () => {
    const { storage } = fixture;
    const first = library.save({ word: "Example", score: 70 });
    const groups = JSON.stringify([{ day: 60, words: [first.id] }]);
    storage.setItem(keys.dailyWordGroups, groups);
    storage.setItem(keys.dailyWordExclusions, '["excluded"]');
    if (fault === "missing") storage.removeItem(keys.words);
    if (fault === "json") storage.setItem(keys.words, "{");
    if (fault === "empty-text") storage.setItem(keys.words, "");
    if (fault === "schema") storage.setItem(keys.words, JSON.stringify([first, { id: 1 }]));
    const read = storage.getItem.bind(storage);
    const original = read(keys.words);
    if (fault === "denied") {
      spyOn(storage, "getItem").mockImplementation((key) => {
        if (key === keys.words) throw new DOMException("Denied", "SecurityError");
        return read(key);
      });
    }
    const writes = spyOn(storage, "setItem");
    const removals = spyOn(storage, "removeItem");
    const reconcile = () =>
      new DailyWordGroupsRepository().syncWords(
        library.list().map((w) => w.id),
        20,
      );
    const operations = [
      reconcile,
      reconcile,
      () => library.save({ word: "New" }),
      () => library.edit({ word: "Changed" }, first.id, first.updatedAt),
      () => library.addMany([{ word: "Imported" }]),
      () => library.removeMany([first.id]),
      () => library.applyScores([{ id: first.id, score: 100 }]),
    ];
    const blocked = operations.map((operation) => {
      try {
        operation();
        return false;
      } catch {
        return true;
      }
    });
    expect(writes.mock.calls).toEqual([]);
    expect(removals.mock.calls).toEqual([]);
    expect(read(keys.words)).toBe(original);
    expect(read(keys.dailyWordGroups)).toBe(groups);
    expect(read(keys.dailyWordExclusions)).toBe('["excluded"]');
    expect(blocked).toEqual(operations.map(() => true));
  });
}

test("missing words with only study history cannot be initialized", () => {
  fixture.storage.setItem(keys.dailyProgress, '{"2026-01-01":["old"]}');
  expect(() => library.save({ word: "New" })).toThrow();
  expect(fixture.storage.getItem(keys.words)).toBeNull();
});

test("legacy plan settings require confirmation and are preserved byte for byte", () => {
  const { storage } = fixture;
  storage.setItem(keys.dailyPlanGroupSize, " 30 ");
  const writes = spyOn(storage, "setItem");
  const removals = spyOn(storage, "removeItem");
  expect(() => library.list()).toThrow(MissingLocalWordsWithPlanSettings);
  expect(() => library.save({ word: "First" })).toThrow(MissingLocalWordsWithPlanSettings);
  expect(writes.mock.calls).toEqual([]);
  recoverEmptyLibrary();
  expect(writes.mock.calls).toEqual([[keys.words, "[]"]]);
  expect(removals.mock.calls).toEqual([]);
  expect(storage.getItem(keys.dailyPlanGroupSize)).toBe(" 30 ");
  expect(library.list()).toEqual([]);
});

for (const [key, raw] of [
  [keys.dailyWordGroups, '[{"day":60,"words":["previous"]}]'],
  [keys.dailyWordExclusions, '["previous"]'],
  [keys.dailyProgress, '{"2026-01-01":["previous"]}'],
  [keys.dailyPlanInitialized, "null"],
  [keys.dailyPlanGroupSize, '"30"'],
]) {
  test(`empty recovery refuses ${key} and preserves raw data`, () => {
    const { storage } = fixture;
    storage.setItem(keys.dailyPlanInitialized, "true");
    storage.setItem(key, raw);
    const writes = spyOn(storage, "setItem");
    const removals = spyOn(storage, "removeItem");
    expect(() => recoverEmptyLibrary()).toThrow();
    expect(writes.mock.calls).toEqual([]);
    expect(removals.mock.calls).toEqual([]);
    expect(storage.getItem(keys.words)).toBeNull();
    expect(storage.getItem(key)).toBe(raw);
  });
}

test("empty recovery rechecks a word key restored after the initial failure", () => {
  const { storage } = fixture;
  const restored = JSON.stringify([library.save({ word: "Existing" })]);
  storage.removeItem(keys.words);
  storage.setItem(keys.dailyPlanInitialized, "true");
  expect(() => library.list()).toThrow(MissingLocalWordsWithPlanSettings);
  storage.setItem(keys.words, restored);
  const writes = spyOn(storage, "setItem");
  recoverEmptyLibrary();
  expect(writes.mock.calls).toEqual([]);
  expect(storage.getItem(keys.words)).toBe(restored);
});

test("valid library writes preserve stored learning fields outside the editable schema", () => {
  const word = library.save({ word: "Example" });
  const srs = { interval: 4 };
  fixture.storage.setItem(keys.words, JSON.stringify([{ ...word, srs }]));
  const added = library.save({ word: "Another" });
  library.addMany([{ word: "Imported" }]);
  library.removeMany([added.id]);
  library.applyScores([{ id: word.id, score: 90 }]);
  expect(JSON.parse(fixture.storage.getItem(keys.words)!)).toContainEqual({
    ...library.list().find((entry) => entry.id === word.id),
    srs,
  });
});

test("first use, explicitly empty and populated libraries accept deliberate changes", () => {
  expect(library.list()).toEqual([]);
  const first = library.save({ word: "First" });
  library.removeMany([first.id]);
  expect(fixture.storage.getItem(keys.words)).toBe("[]");
  fixture.storage.setItem(keys.dailyWordGroups, JSON.stringify([{ day: 60, words: [first.id] }]));
  expect(library.list()).toEqual([]);
  new DailyWordGroupsRepository().syncWords([], 20);
  expect(fixture.storage.getItem(keys.dailyWordGroups)).toBe("[]");
  const next = library.save({ word: "Next" });
  expect(library.list()).toEqual([next]);
});

for (const [key, raw] of [
  [keys.dailyWordGroups, '[{"day":60,"words":["old"]},{"day":1,"words":42}]'],
  [keys.dailyWordGroups, '[{"day":61,"words":["old"]}]'],
  [keys.dailyWordGroups, '[{"day":1,"words":["old"]},{"day":60,"words":["old"]}]'],
  [keys.dailyWordExclusions, '["old",42]'],
  [keys.dailyPlanInitialized, "null"],
  [keys.dailyPlanGroupSize, '"20"'],
]) {
  test(`invalid plan input is preserved without a partial sync: ${key} ${raw}`, () => {
    fixture.storage.setItem(key, raw);
    const writes = spyOn(fixture.storage, "setItem");
    const removals = spyOn(fixture.storage, "removeItem");
    expect(() => new DailyWordGroupsRepository().syncWords(["new"], 20)).toThrow();
    expect(writes.mock.calls).toEqual([]);
    expect(removals.mock.calls).toEqual([]);
    expect(fixture.storage.getItem(key)).toBe(raw);
  });
}
