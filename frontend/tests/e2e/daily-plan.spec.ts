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

test("daily plan can bulk-move several library words into another day", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yds-atlas-words-v1", JSON.stringify(
      ["abandon", "benefit", "indicate"].map((word, index) => ({
        id: `bulk-word-${index}`, word, meanings: [`anlam ${index}`],
        alternatives: [], usageNote: "", partOfSpeech: "Noun", cefr: "B2", score: 10,
        examples: [], pronunciationUk: "", pronunciationUs: "", sourceUrl: "",
        createdAt: `2026-01-01T00:00:0${index}.000Z`,
        updatedAt: `2026-01-01T00:00:0${index}.000Z`,
      })),
    ));
  });
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await page.getByRole("button", { name: "2. güne kelime ekle" }).click();
  const dayDialog = page.getByRole("dialog", { name: "2. günün kelimeleri" });
  await dayDialog.getByRole("button", { name: "Kütüphaneden toplu seç" }).click();
  await expect(dayDialog.getByRole("region", { name: "Kütüphaneden toplu kelime seç" })).toBeVisible();
  const selection = dayDialog.getByRole("region", { name: "Kütüphaneden toplu kelime seç" });
  await selection.getByRole("checkbox", { name: /abandon/ }).check();
  await selection.getByRole("checkbox", { name: /benefit/ }).check();
  page.once("dialog", (confirm) => confirm.accept());
  await dayDialog.getByRole("button", { name: "Seçilen 2 kelimeyi güne ekle" }).click();
  await expect(dayDialog.getByText("anlam 0")).toBeVisible();
  await expect(dayDialog.getByText("anlam 1")).toBeVisible();
  const groups = await page.evaluate(() => JSON.parse(localStorage.getItem("yds-atlas-daily-word-groups-v1") ?? "[]"));
  expect(groups.some((group: { day: number; words: string[] }) => group.day === 2 &&
    group.words.includes("bulk-word-0") && group.words.includes("bulk-word-1"))).toBe(true);
});

test("bulk-created words are assigned to the day chosen before import", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yds-atlas-words-v1", JSON.stringify([{
      id: "existing-day-one", word: "abandon", meanings: ["terk etmek"],
      alternatives: [], usageNote: "", partOfSpeech: "Noun", cefr: "B2", score: 10,
      examples: [], pronunciationUk: "", pronunciationUs: "", sourceUrl: "",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }]));
  });
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await page.getByRole("button", { name: "2. güne kelime ekle" }).click();
  await page.getByRole("dialog", { name: "2. günün kelimeleri" })
    .getByRole("button", { name: "Yeni kelimeleri toplu yaz" }).click();
  const bulk = page.getByRole("dialog", { name: "2. güne toplu kelime ekle" });
  await expect(bulk).toBeVisible();
  await bulk.getByLabel("İngilizce kelime listesi").fill("benefit\nindicate");
  await bulk.getByRole("button", { name: "Yazımı kontrol et" }).click();
  await expect(bulk.getByRole("button", { name: /Kelimeleri ekle/ })).toBeVisible();
  // In the offline spelling fallback, allow the user-approved spelling.
  for (let index = 0; index < 2; index += 1) {
    const approval = bulk.getByRole("button", { name: "Bu yazımı kullan" });
    if (await approval.count() === 0) break;
    await approval.first().click();
  }
  await bulk.getByRole("button", { name: /Kelimeleri ekle/ }).click();
  await expect(bulk).not.toBeVisible();
  await page.getByRole("button", { name: "2. günü aç, 2 kelimeyi yönet" }).click();
  const day2 = page.getByRole("dialog", { name: "2. günün kelimeleri" });
  await expect(day2.getByText("Benefit", { exact: true })).toBeVisible();
  await expect(day2.getByText("Indicate", { exact: true })).toBeVisible();
});
