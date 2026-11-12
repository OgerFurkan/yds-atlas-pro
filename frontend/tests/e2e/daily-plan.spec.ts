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

  const firstGroup = page.locator("article").filter({ has: page.getByRole("button", { name: "1. günü aç, 20 kelimeyi yönet" }) });
  await expect(firstGroup.getByText("15/20")).toBeVisible();
  await expect(firstGroup.getByText("3 zor")).toBeVisible();
  await expect(firstGroup.getByText("2 tekrar")).toBeVisible();
  await expect(firstGroup.getByText("15 öğrenilen")).toBeVisible();
  await page.screenshot({
    path: `test-results/daily-plan-${test.info().project.name}.png`,
    fullPage: false,
  });

  await firstGroup.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  // The initial session is persisted after the new game view mounts.
  await expect.poll(async () => page.evaluate((key) =>
    localStorage.getItem(key), sessionKey,
  )).not.toBeNull();
  const session = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    sessionKey,
  );
  expect(session.words).toHaveLength(5);
  expect(session.words.every((word: { id: string }) => word.id.match(/daily-word-1[5-9]/))).toBe(
    true,
  );
});


test("daily day dialog lists words and remembers remove/reassign actions", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yds-atlas-words-v1", JSON.stringify([
      {
        id: "editable-a", word: "abandon", meanings: ["terk etmek"],
        alternatives: [], usageNote: "", partOfSpeech: "verb", cefr: "B2", score: 10,
        examples: [], pronunciationUk: "", pronunciationUs: "", sourceUrl: "",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]));
  });
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await page.getByRole("button", { name: "1. günü aç, 1 kelimeyi yönet" }).click();
  const dialog = page.getByRole("dialog", { name: "1. günün kelimeleri" });
  await expect(dialog.getByText("terk etmek")).toBeVisible();
  await dialog.getByRole("button", { name: "abandon kelimesini günden çıkar" }).click();
  await expect(dialog.getByText("Bu gün henüz boş")).toBeVisible();
  await dialog.getByLabel("Kütüphaneden kelime ekle / başka günden taşı").selectOption("editable-a");
  await dialog.getByRole("button", { name: "Güne ekle" }).click();
  await expect(dialog.getByText("terk etmek")).toBeVisible();
});
