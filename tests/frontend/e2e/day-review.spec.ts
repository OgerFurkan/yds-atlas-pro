import { expect, test } from "../../../frontend/config/playwright/test-fixtures";

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
      difficulty: ["easy", "easy", "medium", "yds", "yds"][exampleIndex],
      translationFocus: ["Örnek"],
    })),
    pronunciationUk: "",
    pronunciationUs: "",
    sourceUrl: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}

test("a fully learned day offers review without opening a scored study", async ({ page }) => {
  await page.addInitScript(
    (words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)),
    fixture(10),
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  const card = page.getByRole("button", { name: "1. günün kelimeleriyle çalış" });
  await expect(card).toBeDisabled();
  await expect(card).toHaveAccessibleDescription(/gündeki tüm kelimeler öğrenildi/);
  await expect(page).toHaveURL(/#library/);
  await page.getByRole("button", { name: "1. günün kelimelerini puansız tekrar et" }).click();
  await expect(page.locator("#day-review")).toBeVisible();
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

test("scored study skips learned words and replacing an unfinished day session requires confirmation", async ({
  page,
}) => {
  await page.addInitScript(
    (words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)),
    fixture(10).map((entry, index) => ({ ...entry, score: index < 8 ? 90 : 20 })),
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), gameKey))
    .not.toBeNull();
  const before = await page.evaluate((key) => localStorage.getItem(key), gameKey);
  const previous = JSON.parse(before!);
  expect(previous.words.map((entry: { id: string }) => entry.id).sort()).toEqual([
    "review-8",
    "review-9",
  ]);
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await expect(page.getByRole("button", { name: "Kaldığım yerden devam et" })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), gameKey)).toBe(before);
  const cancelTask = page.getByRole("button", { name: "Görevi iptal et" });
  const taskDialog = page.getByRole("alertdialog", { name: "Çalışmayı sonlandır?" });
  await cancelTask.click();
  const keepStudying = taskDialog.getByRole("button", { name: "Çalışmaya devam et" });
  await expect(keepStudying).toBeFocused();
  await keepStudying.click();
  await expect(cancelTask).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), gameKey)).toBe(before);
  await cancelTask.press("Enter");
  await expect(keepStudying).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(cancelTask).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), gameKey)).toBe(before);
  await page.getByRole("button", { name: "Kaldığım yerden devam et" }).click();
  await expect(page.getByRole("button", { name: "Ara ver" })).toBeVisible();
  await cancelTask.click();
  await taskDialog.getByRole("button", { name: "Çalışmayı sonlandır" }).click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  const next = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), gameKey);
  expect(next.id).not.toBe(previous.id);
  expect(next.day).toBe(1);
  expect(next.words.map((entry: { id: string }) => entry.id).sort()).toEqual([
    "review-8",
    "review-9",
  ]);
});

test("clearing a day survives reload while library words and scores stay in place", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, entries }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(entries));
    },
    { key: wordsKey, entries: fixture(2) },
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  const menu = page.getByRole("button", { name: "1. günü düzenle veya sil" });
  const confirm = page.getByRole("alertdialog", { name: "1. günü düzenle veya sil" });
  const initialAssignments = await page.evaluate((key) => localStorage.getItem(key), planKey);
  await menu.click();
  const cancel = confirm.getByRole("button", { name: "Vazgeç" });
  const clear = confirm.getByRole("radio", { name: /Yalnızca günü temizle/ });
  await expect(clear).toBeFocused();
  await expect(clear).toBeChecked();
  await cancel.click();
  await expect(menu).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), planKey)).toBe(initialAssignments);
  await menu.press("Enter");
  await expect(clear).toBeFocused();
  await clear.press("Escape");
  await expect(menu).toBeFocused();
  await menu.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await confirm.getByRole("button", { name: "Günü temizle" }).click();
  await expect(page.getByRole("button", { name: "1. güne kelime ekle" })).toBeFocused();
  await page.reload();
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await expect(page.getByRole("button", { name: "1. güne kelime ekle" })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), wordsKey)).toEqual(
    fixture(2),
  );
});

test("a day with a missing meaning opens the edit path instead of a broken review board", async ({
  page,
}) => {
  const words = fixture(3);
  words[1] = { ...words[1], meanings: [] };
  await page.addInitScript(
    (entries) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(entries)),
    words,
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günün kelimelerini puansız tekrar et" }).click();
  await expect(page.locator("#day-review")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("1 kelimenin Türkçe anlamı eksik");
  await expect(page.locator("#matching-board")).toHaveCount(0);
  await page.getByRole("button", { name: "Eksik kelimeyi düzenle" }).click();
  const editor = page.getByRole("dialog", { name: "Kelimeyi düzenle" });
  await expect(editor.getByRole("textbox", { name: "İngilizce kelime" })).toHaveValue("Word1");
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
    path: test.info().outputPath("day-review-tablet-dark-" + test.info().project.name + ".png"),
  });
  await page.getByRole("button", { name: "Exit" }).click();
  await expect(page.getByTestId("daily-plan-hero")).toBeVisible();
});

test("guest permanent removal needs a second acknowledgement and only deletes that day's cards", async ({
  page,
}) => {
  await page.addInitScript(
    ({ entries, wordsKey, planKey, progressKey }) => {
      if (localStorage.getItem(wordsKey)) return;
      localStorage.setItem("yds-atlas-theme", "dark");
      localStorage.setItem(wordsKey, JSON.stringify(entries));
      localStorage.setItem(
        planKey,
        JSON.stringify([
          { day: 1, words: ["review-0", "review-1"] },
          { day: 2, words: ["review-2"] },
        ]),
      );
      localStorage.setItem(progressKey, JSON.stringify({ completed: ["review-0"] }));
    },
    { entries: fixture(3), wordsKey, planKey, progressKey },
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  const trash = page.getByRole("button", { name: "1. günü düzenle veya sil" });
  await trash.click();
  const choice = page.getByRole("alertdialog", { name: "1. günü düzenle veya sil" });
  await choice.getByRole("radio", { name: /Günü ve kelimeleri sil/ }).check();
  await choice.getByRole("button", { name: "Günü ve kelimeleri sil" }).click();
  const confirm = page.getByRole("alertdialog", { name: "2 kelime kalıcı olarak silinsin mi?" });
  const action = confirm.getByRole("button", { name: "Günü ve kelimeleri sil" });
  const acknowledgement = confirm.getByRole("checkbox");
  await expect(acknowledgement).toBeFocused();
  await expect(action).toBeDisabled();
  await confirm.getByRole("button", { name: "Vazgeç" }).click();
  await expect(trash).toBeFocused();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), wordsKey)).toEqual(
    fixture(3),
  );
  await trash.click();
  await choice.getByRole("radio", { name: /Günü ve kelimeleri sil/ }).check();
  await choice.getByRole("button", { name: "Günü ve kelimeleri sil" }).click();
  await acknowledgement.press("Space");
  await action.click();
  await expect(page.getByRole("button", { name: "1. güne kelime ekle" })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await expect(page.getByRole("button", { name: "2. günü aç, 1 kelimeyi yönet" })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), wordsKey)).toEqual(
    fixture(3).slice(2),
  );
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), progressKey)).toEqual(
    { completed: ["review-0"] },
  );
});

test("day clear preserves a word also assigned to another day", async ({ page }) => {
  await page.addInitScript(
    ({ words, key }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(words));
    },
    { words: fixture(2), key: wordsKey },
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  const trash = page.getByRole("button", { name: "1. günü düzenle veya sil" });
  await expect(trash).toBeVisible();
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify([
          { day: 1, words: ["review-0", "review-1"] },
          { day: 2, words: ["review-1"] },
        ]),
      ),
    planKey,
  );
  await trash.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/1 kelime başka bir güne de atanmış/)).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Günü ve kelimeleri sil/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "Günü temizle" }).click();
  await expect(page.getByRole("button", { name: "2. günü aç, 1 kelimeyi yönet" })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), wordsKey)).toEqual(
    fixture(2),
  );
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
