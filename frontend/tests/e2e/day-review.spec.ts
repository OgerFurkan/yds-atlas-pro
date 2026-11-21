import { expect, test } from "@playwright/test";

const gameKey = "yds-atlas-learning-session-v2";
const wordsKey = "yds-atlas-words-v1";
const planKey = "yds-atlas-daily-word-groups-v1";
const progressKey = "yds-atlas-daily-progress-v1";

function fixture(count: number, sharedMeaning = false) {
  return Array.from({ length: count }, (_, index) => ({
    id: "review-" + index,
    word: "Word" + index,
    meanings: [sharedMeaning ? "aynı anlam" : "Anlam " + index],
    alternatives: [], usageNote: "", partOfSpeech: "Noun", cefr: "B2",
    score: 90,
    examples: Array.from({ length: 5 }, (_, exampleIndex) => ({
      sentence: "The Word" + index + " is in example " + exampleIndex + ".",
      translation: "Örnek " + index + ".",
    })),
    pronunciationUk: "", pronunciationUs: "", sourceUrl: "",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}

test("completed day study can reopen learned words with their scores intact", async ({ page }) => {
  await page.addInitScript((words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)), fixture(10));
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  const card = page.getByRole("button", { name: "1. günün kelimeleriyle çalış" });
  await expect(card).toBeEnabled();
  await card.click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  const scores = await page.evaluate(() => JSON.parse(localStorage.getItem("yds-atlas-words-v1") ?? "[]").map((word: { score: number }) => word.score));
  expect(scores).toEqual(Array(10).fill(90));
});

test("review is isolated from words, day assignments, progress and saved game", async ({ page }) => {
  await page.addInitScript((words) => {
    localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words));
    localStorage.setItem("yds-atlas-daily-progress-v1", JSON.stringify({ completed: ["keep"] }));
  }, fixture(11, true));
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  const original = await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    [wordsKey, planKey, progressKey, gameKey]);
  await page.getByRole("button", { name: "1. günün kelimelerini puansız tekrar et" }).click();
  await expect(page.locator("#day-review")).toBeVisible();
  await expect(page.getByText(/1 \/ 2 tur/)).toBeVisible();
  const first = page.locator('[data-matching-side="left"]:not([disabled])').first();
  const id = await first.getAttribute("data-word-id");
  await first.click();
  await page.locator('[data-matching-side="right"][data-word-id="' + id + '"]').click();
  await expect(page.locator('[data-matching-side="left"][data-word-id="' + id + '"]')).toBeDisabled();
  await page.getByRole("button", { name: "Çık" }).click();
  await expect(page.getByTestId("daily-plan-hero")).toBeVisible();
  const after = await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    [wordsKey, planKey, progressKey, gameKey]);
  expect(after).toEqual(original);
});
