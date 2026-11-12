import { expect, test } from "@playwright/test";

const sessionKey = "yds-atlas-learning-session-v2";

test("daily plan groups words by day and starts the selected group directly", async ({ page }) => {
  await page.addInitScript(() => {
    const words = Array.from({ length: 20 }, (_, index) => {
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      return {
        id: `daily-word-${index}`,
        word: `dailyword${index}`,
        meanings: [`Test anlamı ${index}`],
        alternatives: [],
        usageNote: "",
        partOfSpeech: "Noun",
        cefr: "B2",
        score: index < 15 ? 90 : index < 18 ? 20 : 50,
        examples: Array.from({ length: 5 }, (_, exampleIndex) => ({
          sentence: `The dailyword${index} appears in context ${exampleIndex}.`,
          translation: `Çeviri ${index}-${exampleIndex}.`,
        })),
        pronunciationUk: "",
        pronunciationUs: "",
        sourceUrl: "",
        createdAt,
        updatedAt: createdAt,
      };
    });
    localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words));
  });

  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();

  const firstGroup = page.locator("article").filter({ hasText: "dailyword0" }).first();
  await expect(firstGroup.getByText("15/20")).toBeVisible();
  await expect(firstGroup.getByText("Zorlanılan")).toBeVisible();
  await expect(firstGroup.getByText("Tekrar")).toBeVisible();
  await expect(firstGroup.getByText("Öğrenilen").first()).toBeVisible();
  await page.screenshot({
    path: `test-results/daily-plan-${test.info().project.name}.png`,
    fullPage: false,
  });

  await firstGroup.getByRole("button", { name: "1. gün grubuna çalış" }).click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  const session = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    sessionKey,
  );
  expect(session.words).toHaveLength(5);
  expect(session.words.every((word: { id: string }) => word.id.match(/daily-word-1[5-9]/))).toBe(
    true,
  );
});
