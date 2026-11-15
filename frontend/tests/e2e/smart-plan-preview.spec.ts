import { expect, test } from "@playwright/test";

/** Learning Coach V2: the daily plan links to the evidence-first coach; guest work stays local. */
test("daily plan opens the coach and starts only the explicitly selected task", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "1. günü aç, 3 kelimeyi yönet" })).toBeVisible();
  await expect(page.getByText("Atlas Koç artık tüm kütüphaneni değerlendiriyor.")).toBeVisible();

  const before = await page.evaluate(() => localStorage.getItem("yds-atlas-daily-word-groups-v1"));
  await page.getByRole("button", { name: "İlerleme ve Akıllı Koç" }).click();
  await expect(page).toHaveURL(/#progress$/);
  await expect(page.getByTestId("progress-calendar-page")).toBeVisible();

  const coach = page.getByRole("region", { name: "Bugün neye çalışmalısın?" });
  await expect(coach).toBeVisible();
  const recover = coach.getByRole("heading", { name: "Yanlışları güvenle toparla" });
  await expect(recover).toBeVisible();
  await expect(coach.getByRole("heading", { name: "Kalıcılığı güçlendir" })).toBeVisible();
  await expect(coach.getByRole("heading", { name: "Yeni kelime için ilk yoklama" })).toBeVisible();

  // No game session may start simply by inspecting the coach.
  const idleSession = await page.evaluate(() => localStorage.getItem("yds-atlas-learning-session-v2"));
  expect(idleSession).toBeNull();

  // Merely opening the coach is read-only: no cloud daily-plan call or group rewrite.
  const afterOpening = await page.evaluate(() => localStorage.getItem("yds-atlas-daily-word-groups-v1"));
  expect(afterOpening).toBe(before);
  expect(cloudCalls).toBe(0);

  // Only the selected recovery bucket (hardword) may enter the game session.
  await recover.locator("xpath=../..").getByRole("button", { name: "Çalış", exact: true }).click();
  await expect(page).toHaveURL(/#game$/);
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const saved = localStorage.getItem("yds-atlas-learning-session-v2");
    return saved ? JSON.parse(saved).words.map((word: { id: string }) => word.id) : [];
  })).toEqual(["hardword"]);

  const afterStudyStart = await page.evaluate(() => localStorage.getItem("yds-atlas-daily-word-groups-v1"));
  expect(afterStudyStart).toBe(before);
  expect(cloudCalls).toBe(0);
});
