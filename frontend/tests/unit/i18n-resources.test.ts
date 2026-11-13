import { expect, test } from "bun:test";
import { tr } from "../../src/shared/i18n/locales/tr";
import { en } from "../../src/shared/i18n/locales/en";

function describeShape(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return [`${prefix}:array:${value.length}`];
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, val]) =>
      describeShape(val, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [`${prefix}:${typeof value}`];
}

test("Turkish and English resources expose identical keys and types", () => {
  expect(describeShape(tr).sort()).toEqual(describeShape(en).sort());
});

test("Translations include every feature section", () => {
  expect(Object.keys(tr).length).toBeGreaterThan(10);
  expect(Object.keys(en).length).toBe(Object.keys(tr).length);
});
