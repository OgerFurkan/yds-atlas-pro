import { expect, test } from "@playwright/test";

/** Phase 4A v2: guest preview stays local; study starts only on explicit click. */
test("smart plan preview recommends ready words and starts only the selected task", async ({ page }) => {
  await page.addInitScript(() => {
    const create = (id: string, score: number) => ({
      id,
      word: id,
      score,
      alternatives: [],
      meanings: ["test anlamı"],
      usageNote: "",
      partOfSpeech: "noun",
      cefr: "B1",
      examples: Array.from({ length: 5 }, (_, index) => ({
        sentence: `We use ${id} in example ${index}.`,
        translation: `Örnek ${index}`,
      })),
      pronunciationUk: "",
      pronunciationUs: "",
      sourceUrl: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    localStorage.setItem("yds-atlas-words-v1", JSON.stringify([
      create("hardword", 20), create("newword", 0), create("learnedword", 90),
    ]));
  });

  let cloudCalls = 0;
  await page.route("**/api/account/daily-plan**", async (route) => {
    cloudCalls += 1;
    await route.abort();
  });

  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  const panel = page.getByRole("region", { name: "Bugünün akıllı planı" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Tekrar takvimi uygulamaya henüz bağlanmadı", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "1. günü aç, 3 kelimeyi yönet" })).toBeVisible();

  const before = await page.evaluate(() => localStorage.getItem("yds-atlas-daily-word-groups-v1"));
  await panel.getByRole("button", { name: "Plan oluştur" }).click();
  await expect(panel.getByText("2 çalışma adımı")).toBeVisible();
  await expect(panel.getByText("3 dk planlandı", { exact: false })).toHaveCount(0);
  const after = await page.evaluate(() => localStorage.getItem("yds-atlas-daily-word-groups-v1"));
  expect(after).toBe(before);
  expect(cloudCalls).toBe(0);

  await panel.getByRole("button", { name: "Zorlanılan kelimeler · 1 kelimeyi çalış" }).click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const saved = localStorage.getItem("yds-atlas-learning-session-v2");
    return saved ? JSON.parse(saved).words.map((word: { id: string }) => word.id) : [];
  })).toEqual(["hardword"]);
});
