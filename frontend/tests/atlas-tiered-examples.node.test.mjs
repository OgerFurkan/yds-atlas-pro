import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/features/word-library/model/tiered-examples.ts", import.meta.url), "utf8");
const code = stripTypeScriptTypes(source, { mode: "transform" })
  .replace(/^export /gm, "") + "\nObject.assign(module.exports, { hasAtlasTiers, ATLAS_TIER_ORDER });";
const module = { exports: {} };
runInNewContext(code, { module, exports: module.exports });
const { hasAtlasTiers, ATLAS_TIER_ORDER } = module.exports;
const examples = ATLAS_TIER_ORDER.map((difficulty, index) => ({
  sentence: `Students carefully obtain evidence number ${index + 1}.`,
  translation: `Öğrenciler ${index + 1}. kanıtı elde eder.`,
  translationFocus: ["elde eder"], difficulty,
}));
test("new word 2/1/2 tiers and Turkish focus pass", () => {
  assert.equal(hasAtlasTiers(examples), true);
  assert.deepEqual([...ATLAS_TIER_ORDER], ["easy","easy","medium","yds","yds"]);
});
test("missing, incorrect, reordered or untranslated tiers fail closed", () => {
  assert.equal(hasAtlasTiers(examples.slice(0,4)), false);
  assert.equal(hasAtlasTiers([...examples, {sentence:"User note", translation:"Kullanıcı notu", difficulty:"easy", translationFocus:["notu"]}]), true);
  assert.equal(hasAtlasTiers(examples.map((e,i)=>i===3?{...e,difficulty:"easy"}:e)), false);
  assert.equal(hasAtlasTiers(examples.map((e,i)=>i===2?{...e,translationFocus:["uydurma"]}:e)), false);
  assert.equal(hasAtlasTiers(examples.map((e,i)=>i===0?{...e,translation:""}:e)), false);
});
