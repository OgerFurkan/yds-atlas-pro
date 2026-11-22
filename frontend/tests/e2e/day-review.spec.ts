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
    alternatives: [],
    usageNote: "",
    partOfSpeech: "Noun",
    cefr: "B2",
    score: 90,
    examples: Array.from({ length: 5 }, (_, exampleIndex) => ({
      sentence: "The Word" + index + " is in example " + exampleIndex + ".",
      translation: "Örnek " + index + ".",
    })),
    pronunciationUk: "",
    pronunciationUs: "",
    sourceUrl: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}

test("completed day study can reopen learned words with their scores intact", async ({ page }) => {
  await page.addInitScript(
    (words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)),
    fixture(10),
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  const card = page.getByRole("button", { name: "1. günün kelimeleriyle çalış" });
  await expect(card).toBeEnabled();
  await card.click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  const scores = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yds-atlas-words-v1") ?? "[]").map(
      (word: { score: number }) => word.score,
    ),
  );
  expect(scores).toEqual(Array(10).fill(90));
});

test("review is isolated from words, day assignments, progress and saved game", async ({
  page,
}) => {
  await page.addInitScript(
    (words) => {
      localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words));
      localStorage.setItem("yds-atlas-daily-progress-v1", JSON.stringify({ completed: ["keep"] }));
    },
    fixture(11, true),
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  const original = await page.evaluate(
    (keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    [wordsKey, planKey, progressKey, gameKey],
  );
  await page.getByRole("button", { name: "1. günün kelimelerini puansız tekrar et" }).click();
  await expect(page.locator("#day-review")).toBeVisible();
  await expect(page.getByText(/1 \/ 2 tur/)).toBeVisible();
  const first = page.locator('[data-matching-side="left"]:not([disabled])').first();
  const id = await first.getAttribute("data-word-id");
  await first.click();
  await page.locator('[data-matching-side="right"][data-word-id="' + id + '"]').click();
  await expect(
    page.locator('[data-matching-side="left"][data-word-id="' + id + '"]'),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Çık" }).click();
  await expect(page.getByTestId("daily-plan-hero")).toBeVisible();
  const after = await page.evaluate(
    (keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    [wordsKey, planKey, progressKey, gameKey],
  );
  expect(after).toEqual(original);
});

test("single-word review finishes, restarts, exits and preserves the library", async ({ page }) => {
  await page.addInitScript(
    (words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)),
    fixture(1, true),
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  const before = await page.evaluate(() => localStorage.getItem("yds-atlas-words-v1"));
  await page.getByRole("button", { name: "1. günün kelimelerini puansız tekrar et" }).click();
  await page.locator('[data-matching-side="left"]').first().click();
  await page.locator('[data-matching-side="right"]').first().click();
  await page.locator("#matching-next").click();
  await expect(page.getByText("Tüm kelimeleri tekrar ettin!")).toBeVisible();
  await page.getByRole("button", { name: "Tekrar Başlat" }).click();
  await expect(page.getByText(/1 \/ 1 tur/)).toBeVisible();
  await page.getByRole("button", { name: "Çık" }).click();
  expect(await page.evaluate(() => localStorage.getItem("yds-atlas-words-v1"))).toBe(before);
});

test("a saved unfinished study session survives clicking Study on a completed day", async ({
  page,
}) => {
  await page.addInitScript(
    (words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)),
    fixture(10),
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), gameKey))
    .not.toBeNull();
  const before = await page.evaluate((key) => localStorage.getItem(key), gameKey);
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await expect(page.getByRole("button", { name: "Kaldığım yerden devam et" })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), gameKey)).toBe(before);
});

test("English dark-mode review fits a tablet viewport without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.addInitScript((words) => {
    localStorage.setItem("yds-atlas-language", "en");
    localStorage.setItem("yds-atlas-theme", "dark");
    localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words));
  }, fixture(11));
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Daily Plan" }).click();
  await page.getByRole("button", { name: "Review day 1 words without points" }).click();
  await expect(page.getByRole("heading", { name: "Day 1 · Review" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/day-review-tablet-dark-" + test.info().project.name + ".png",
  });
  await page.getByRole("button", { name: "Exit" }).click();
  await expect(page.getByTestId("daily-plan-hero")).toBeVisible();
});

test("short laptop review uses compact 5-pair board instead of forcing 10 rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(
    (words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)),
    fixture(11),
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günün kelimelerini puansız tekrar et" }).click();
  await expect(page.getByText(/1 \/ 2 tur/)).toBeVisible();
  await expect(page.locator('[data-matching-side="left"]')).toHaveCount(5);
  const header = page.locator("#day-review-header");
  const headingBox = await header
    .getByRole("heading", { name: "1. gün · Tekrar Et" })
    .boundingBox();
  const headerBox = await header.boundingBox();
  expect(headingBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(
    Math.abs(headingBox!.x + headingBox!.width / 2 - (headerBox!.x + headerBox!.width / 2)),
  ).toBeLessThanOrEqual(2);
  expect(headerBox!.height).toBeLessThanOrEqual(106);
  await expect(
    header.getByText("Puan, SRS, günlük ilerleme ve kayıtlı oturum korunur."),
  ).toBeVisible();
  const rect = await page.locator("#matching-board").boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(768);
});

test("mobile review presents accessible 4-pair board and keeps the round size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.addInitScript(
    (words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)),
    fixture(11),
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günün kelimelerini puansız tekrar et" }).click();
  await expect(page.locator('[data-matching-side="left"]')).toHaveCount(4);
  await expect(page.getByText(/1 \/ 2 tur/)).toBeVisible();
  const header = page.locator("#day-review-header");
  const headingBox = await header
    .getByRole("heading", { name: "1. gün · Tekrar Et" })
    .boundingBox();
  const headerBox = await header.boundingBox();
  expect(headingBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(
    Math.abs(headingBox!.x + headingBox!.width / 2 - (headerBox!.x + headerBox!.width / 2)),
  ).toBeLessThanOrEqual(2);
  const minTarget = await page
    .locator('[data-matching-side="left"]')
    .first()
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(minTarget).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
