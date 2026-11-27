import { expect, test } from "../../../frontend/config/playwright/test-fixtures";

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
          difficulty: ["easy", "easy", "medium", "yds", "yds"][exampleIndex],
          translationFocus: [`Çeviri ${index}`],
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

  const firstGroup = page
    .locator("article")
    .filter({ has: page.getByRole("button", { name: "1. günü aç, 20 kelimeyi yönet" }) });
  await expect(firstGroup.getByText("15/20")).toBeVisible();
  await expect(firstGroup.getByText("3 zor")).toBeVisible();
  await expect(firstGroup.getByText("2 tekrar")).toBeVisible();
  await expect(firstGroup.getByText("15 öğrenilen")).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath(`daily-plan-${test.info().project.name}.png`),
    fullPage: false,
  });

  await firstGroup.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  // The initial session is persisted after the new game view mounts.
  await expect
    .poll(async () => page.evaluate((key) => localStorage.getItem(key), sessionKey))
    .not.toBeNull();
  const session = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    sessionKey,
  );
  expect(session.words.map((word: { id: string }) => word.id).sort()).toEqual([
    "daily-word-15",
    "daily-word-16",
    "daily-word-17",
    "daily-word-18",
    "daily-word-19",
  ]);
});

test("daily day dialog lists words and remembers remove/reassign actions", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "yds-atlas-words-v1",
      JSON.stringify([
        {
          id: "editable-a",
          word: "abandon",
          meanings: ["terk etmek"],
          alternatives: [],
          usageNote: "",
          partOfSpeech: "verb",
          cefr: "B2",
          score: 10,
          examples: [],
          pronunciationUk: "",
          pronunciationUs: "",
          sourceUrl: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
  });
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await page.getByRole("button", { name: "1. günü aç, 1 kelimeyi yönet" }).click();
  const dialog = page.getByRole("dialog", { name: "1. Gün · Kelimeler" });
  await expect(dialog.getByText("terk etmek")).toBeVisible();
  await dialog.getByRole("button", { name: "abandon kelimesini günden çıkar" }).click();
  await expect(dialog.getByText("Bu gün henüz boş")).toBeVisible();
  await dialog.getByRole("button", { name: "Kelime ekle", exact: true }).press("Enter");
  await page.getByRole("menuitem", { name: "Kütüphaneden seç" }).press("Enter");
  await dialog.getByRole("checkbox", { name: /abandon/ }).check();
  await dialog.getByRole("button", { name: "Seçilen 1 kelimeyi güne ekle" }).click();
  await expect(dialog.getByText("terk etmek")).toBeVisible();
});

test("daily plan can bulk-move several library words into another day", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "yds-atlas-words-v1",
      JSON.stringify(
        ["abandon", "benefit", "indicate"].map((word, index) => ({
          id: `bulk-word-${index}`,
          word,
          meanings: [`anlam ${index}`],
          alternatives: [],
          usageNote: "",
          partOfSpeech: "Noun",
          cefr: "B2",
          score: 10,
          examples: [],
          pronunciationUk: "",
          pronunciationUs: "",
          sourceUrl: "",
          createdAt: `2026-01-01T00:00:0${index}.000Z`,
          updatedAt: `2026-01-01T00:00:0${index}.000Z`,
        })),
      ),
    );
  });
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await page.getByRole("button", { name: "2. güne kelime ekle" }).click();
  const dayDialog = page.getByRole("dialog", { name: "2. Gün · Kelimeler" });
  await dayDialog.getByRole("button", { name: "Kelime ekle", exact: true }).click();
  await page.getByRole("menuitem", { name: "Kütüphaneden seç" }).click();
  await expect(
    dayDialog.getByRole("region", { name: "Kütüphaneden toplu kelime seç" }),
  ).toBeVisible();
  const selection = dayDialog.getByRole("region", { name: "Kütüphaneden toplu kelime seç" });
  await selection.getByRole("checkbox", { name: /abandon/ }).check();
  await selection.getByRole("checkbox", { name: /benefit/ }).check();
  page.once("dialog", (confirm) => confirm.accept());
  await dayDialog.getByRole("button", { name: "Seçilen 2 kelimeyi güne ekle" }).click();
  await expect(selection).toHaveCount(0);
  await expect(dayDialog.getByText("anlam 0")).toBeVisible();
  await expect(dayDialog.getByText("anlam 1")).toBeVisible();
  const groups = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yds-atlas-daily-word-groups-v1") ?? "[]"),
  );
  expect(
    groups.some(
      (group: { day: number; words: string[] }) =>
        group.day === 2 &&
        group.words.includes("bulk-word-0") &&
        group.words.includes("bulk-word-1"),
    ),
  ).toBe(true);
});

for (const interrupted of [false, true])
  test("bulk-created words keep their chosen day, interrupted=" + interrupted, async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem("yds-atlas-words-v1") !== null) return;
      localStorage.setItem(
        "yds-atlas-words-v1",
        JSON.stringify([
          {
            id: "existing-day-one",
            word: "abandon",
            meanings: ["terk etmek"],
            alternatives: [],
            usageNote: "",
            partOfSpeech: "Noun",
            cefr: "B2",
            score: 10,
            examples: [],
            pronunciationUk: "",
            pronunciationUs: "",
            sourceUrl: "",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
      );
    });
    await page.goto("/#library");
    await page.getByRole("tab", { name: /Günlük Plan/ }).click();
    await page.getByRole("button", { name: "2. güne kelime ekle" }).click();
    await page
      .getByRole("dialog", { name: "2. Gün · Kelimeler" })
      .getByRole("button", { name: "Kelime ekle", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Toplu kelime ekle" }).click();
    const bulk = page.getByRole("dialog", { name: "2. güne toplu kelime ekle" });
    await expect(bulk).toBeVisible();
    await bulk.getByLabel("İngilizce kelime listesi").fill("benefit\nindicate");
    await bulk.getByRole("button", { name: "Yazımı kontrol et" }).click();
    await expect(bulk.getByRole("button", { name: /Kelimeleri ekle/ })).toBeVisible();
    // In the offline spelling fallback, allow the user-approved spelling.
    for (let index = 0; index < 2; index += 1) {
      const approval = bulk.getByRole("button", { name: "Bu yazımı kullan" });
      if ((await approval.count()) === 0) break;
      await approval.first().click();
    }
    if (interrupted)
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "yds-atlas-daily-word-groups-v1")
            throw new DOMException("synthetic quota", "QuotaExceededError");
          original.call(this, key, value);
        };
      });
    await bulk.getByRole("button", { name: /Kelimeleri ekle/ }).click();
    if (interrupted) {
      await expect(page.getByText(/Tarayıcı kaydı yapılamadı/).first()).toBeVisible();
      await page.reload();
      await page.getByRole("tab", { name: /Günlük Plan/ }).click();
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem("yds-atlas-words-v1")!).length),
      ).toBe(3);
    }
    await expect(bulk).not.toBeVisible();
    await page.getByRole("button", { name: "2. günü aç, 2 kelimeyi yönet" }).click();
    const day2 = page.getByRole("dialog", { name: "2. Gün · Kelimeler" });
    await expect(day2.getByText("Benefit", { exact: true })).toBeVisible();
    await expect(day2.getByText("Indicate", { exact: true })).toBeVisible();
  });

for (const score of [90, 20]) {
  test(
    "filled day without ready words disables both Study actions and preserves progress (" +
      score +
      ")",
    async ({ page }) => {
      await page.addInitScript((value) => {
        const word = {
          id: "unready-word",
          word: "Abandon",
          meanings: ["terk etmek"],
          alternatives: [],
          usageNote: "",
          partOfSpeech: "Verb",
          cefr: "B2",
          score: value,
          examples: [],
          pronunciationUk: "",
          pronunciationUs: "",
          sourceUrl: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        localStorage.setItem("yds-atlas-words-v1", JSON.stringify([word]));
        // Preserve even a legacy/malformed saved session; starting an unready day cannot rewrite it.
        localStorage.setItem("yds-atlas-learning-session-v2", '{"oldGame":"preserve"}');
      }, score);
      await page.goto("/#library");
      await page.getByRole("tab", { name: "Günlük Plan" }).click();
      const original = await page.evaluate(() => ({
        words: localStorage.getItem("yds-atlas-words-v1"),
        game: localStorage.getItem("yds-atlas-learning-session-v2"),
      }));
      const studyCard = page.getByRole("button", { name: "1. günün kelimeleriyle çalış" });
      await expect(studyCard).toBeDisabled();
      await expect(studyCard).toHaveAccessibleDescription(
        score >= 80 ? /gündeki tüm kelimeler öğrenildi/ : /beş uygun örnek cümleyi/,
      );
      await expect(page).toHaveURL(/#library/);
      await page.getByRole("button", { name: "1. günü aç, 1 kelimeyi yönet" }).click();
      const dialog = page.getByRole("dialog", { name: "1. Gün · Kelimeler" });
      const dialogStudy = dialog.getByRole("button", { name: "Çalış", exact: true });
      await expect(dialogStudy).toBeDisabled();
      if (score < 80)
        await expect(
          dialog.getByRole("button", { name: "Kelime bilgilerini tamamla" }),
        ).toBeVisible();
      const after = await page.evaluate(() => ({
        words: localStorage.getItem("yds-atlas-words-v1"),
        game: localStorage.getItem("yds-atlas-learning-session-v2"),
      }));
      expect(after).toEqual(original);
      await expect(page).toHaveURL(/#library/);
    },
  );
}
