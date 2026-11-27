import { expect, type Page, test } from "../../../frontend/config/playwright/test-fixtures";
import { incompleteDayWords, installDayStudyMock, readyDayWords } from "../fixtures/day-study-mock";

const prepare = "1. günü hazırla ve çalış";
const study = "1. günün kelimeleriyle çalış";
const flashcard = "Kartı çevir ve anlamı göster";
const dayTitle = "Gün 1 · Günlük Plan";

async function openPlan(page: Page) {
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
}

test("bulk import shows a real save error, retries, and reports incomplete words as saved", async ({
  page,
}) => {
  let status = 502;
  const fixture = await installDayStudyMock(page, {
    words: incompleteDayWords,
    importStatus: () => status,
  });
  await openPlan(page);
  await page.getByRole("button", { name: "1. günü aç, 4 kelimeyi yönet" }).click();
  await page.getByRole("button", { name: "Kelime ekle", exact: true }).click();
  await page.getByRole("menuitem", { name: "Toplu kelime ekle" }).click();
  const bulk = page.getByRole("dialog", { name: "1. güne toplu kelime ekle" });
  await bulk.getByRole("textbox", { name: "İngilizce kelime listesi" }).fill("x".repeat(121));
  await bulk.getByRole("button", { name: "Yazımı kontrol et" }).click();
  await expect(bulk.getByText("Bir kelime en fazla 120 karakter olabilir.")).toBeVisible();
  expect(fixture.requests.imports).toBe(0);
  await bulk
    .getByRole("textbox", { name: "İngilizce kelime listesi" })
    .fill("apple = elma\ntable = masa");
  await bulk.getByRole("button", { name: "Yazımı kontrol et" }).click();
  const save = bulk.getByRole("button", { name: "Manuel kaydet" });
  await save.click();
  const pending = page.getByRole("region", { name: "Bekleyen plan işlemi" });
  await expect(pending.getByRole("status")).toContainText("Sentetik kayıt hatası");
  await expect(pending.getByRole("status")).not.toContainText("LOCAL sentetik test fixture");
  expect(fixture.words).toHaveLength(4);
  status = 200;
  await pending.getByRole("button", { name: "Aynı işlemi yeniden doğrula" }).click();
  await expect(pending).toHaveCount(0);
  await expect(page.getByRole("button", { name: "1. günü aç, 6 kelimeyi yönet" })).toBeVisible();
  expect(fixture.requests.imports).toBe(2);
  expect(fixture.requests.importCommands[1]).toBe(fixture.requests.importCommands[0]);
  expect(fixture.requests.complete).toEqual([]);
  await page.getByRole("button", { name: "1. günü aç, 6 kelimeyi yönet" }).click();
  await page.getByRole("button", { name: "Kelime ekle", exact: true }).click();
  await page.getByRole("menuitem", { name: "Toplu kelime ekle" }).click();
  await bulk.getByRole("textbox", { name: "İngilizce kelime listesi" }).fill("fruit");
  await bulk.getByRole("button", { name: "Yazımı kontrol et" }).click();
  await expect(bulk.getByRole("button", { name: "AI ile tamamla ve ekle (1)" })).toBeEnabled();
  await bulk.getByRole("button", { name: "Manuel kaydet" }).click();
  await expect(bulk).toHaveCount(0);
  await expect(
    page.getByText(/Kütüphaneye 1 kelime eklendi.*1 kelimeyle çalışmak için/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "1. günü aç, 7 kelimeyi yönet" })).toBeVisible();
  expect(fixture.words.find((word) => word.word.toLowerCase() === "fruit")?.meanings).toEqual([]);
  expect(fixture.requests.complete).toEqual([]);
});

test("a stale offline check is refreshed on focus without starting Gemini", async ({ page }) => {
  await page.clock.install();
  let status = 502;
  const fixture = await installDayStudyMock(page, {
    words: incompleteDayWords,
    health: () => status,
  });
  await openPlan(page);
  await expect(page.getByRole("button", { name: study })).toHaveAccessibleDescription(/HTTP 502/);
  status = 200;
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: prepare })).toBeEnabled();
  expect(fixture.requests.health).toBe(2);
  expect(fixture.requests.complete).toEqual([]);
});

test("502 and pending health keep the zero-ready day blocked while settings restrict diagnostics", async ({
  page,
}) => {
  let finish = (_status: number) => {};
  const checking = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const fixture = await installDayStudyMock(page, {
    words: incompleteDayWords,
    health: () => checking,
  });
  try {
    await openPlan(page);
    const action = page.getByRole("button", { name: study });
    await expect(action).toBeDisabled();
    await expect(action).toHaveAccessibleDescription(/Gemini bağlantısı kontrol ediliyor/);
    finish(502);
    await expect(action).toHaveAccessibleDescription(/HTTP 502/);
    await expect(action).toBeDisabled();
    const settingsButton = page
      .getByRole("button", { name: "Ayarlar", exact: true })
      .filter({ visible: true });
    if (!(await settingsButton.isVisible()))
      await page.getByRole("button", { name: "Menüyü aç" }).click();
    await settingsButton.click();
    const settings = page.getByRole("dialog");
    await expect(settings.getByRole("heading", { name: "Gemini teknik durumu" })).toHaveCount(0);
    await expect(settings.getByText(/HTTP 502/)).toHaveCount(0);
    expect(fixture.requests.health).toBe(1);
    await settings.getByRole("button", { name: "Koyu", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.locator("#daily-day-1-open").click();
    const detail = page.getByRole("dialog", { name: "1. Gün · Kelimeler" });
    await expect(detail.getByRole("button", { name: "Çalış", exact: true })).toBeDisabled();
    await expect(detail.getByRole("status").filter({ hasText: "HTTP 502" })).toHaveCSS(
      "color",
      "rgb(232, 238, 241)",
    );
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await detail.getByRole("button", { name: "Kelime bilgilerini tamamla", exact: true }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Kelimeyi düzenle" })
        .getByRole("textbox", { name: "İngilizce kelime" }),
    ).toHaveValue("Assess");
    expect(fixture.requests.complete).toEqual([]);
    expect(fixture.requests.saved).toEqual([]);
    expect(fixture.getSession()).toBeUndefined();
  } finally {
    finish(502);
  }
});

test("20 ready fixture words open a day session without AI and keep its identity after reload", async ({
  page,
}) => {
  const fixture = await installDayStudyMock(page, { words: readyDayWords, health: () => 502 });
  await openPlan(page);
  await expect(page.getByText("Hazır: 20 / 20")).toBeVisible();
  await page.getByRole("button", { name: study }).click();
  await expect(page.getByRole("button", { name: flashcard })).toBeVisible();
  await expect(page.getByText(dayTitle, { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      fixture
        .getSession()
        ?.words.map((word) => word.id)
        .sort(),
    )
    .toEqual(readyDayWords.map((word) => word.id).sort());
  await page.reload();
  await page.getByRole("button", { name: "Kaldığım yerden devam et" }).click();
  await expect(page.getByText(dayTitle, { exact: true })).toBeVisible();
  expect(fixture.requests.complete).toEqual([]);
  expect(fixture.words).toEqual(readyDayWords);
});

test("one click completes four assigned words without entering the general 20-word setup", async ({
  page,
}) => {
  const fixture = await installDayStudyMock(page, { words: incompleteDayWords, lookup: "assess" });
  await openPlan(page);
  await page.getByRole("button", { name: prepare }).click();
  await expect(page.getByRole("button", { name: flashcard })).toBeVisible();
  await expect(page.locator("#task-setup-panels")).toHaveCount(0);
  await expect.poll(() => fixture.getSession()?.words.length).toBe(4);
  expect(fixture.requests.complete).toEqual([["Reliable", "Evidence", "Decline"]]);
  expect(fixture.requests.saved).toEqual(incompleteDayWords.map((word) => word.id));
  expect(fixture.words.every((word) => word.score === 0 && word.examples.length === 5)).toBe(true);
});

test("partial readiness is explained and Study runs only the ready words even with AI offline", async ({
  page,
}) => {
  const fixture = await installDayStudyMock(page, {
    words: [readyDayWords[0], ...incompleteDayWords.slice(1)],
    health: () => 502,
  });
  await openPlan(page);
  const action = page.getByRole("button", { name: study });
  await expect(action).toHaveAccessibleDescription(/3 eksik kelime bu çalışmaya alınmayacak/);
  await action.click();
  await expect(page.getByRole("button", { name: flashcard })).toBeVisible();
  await expect
    .poll(() => fixture.getSession()?.words.map((word) => word.id))
    .toEqual([readyDayWords[0].id]);
  expect(fixture.requests.complete).toEqual([]);
});

test("saved progress survives cancellation, late results and reload", async ({ page }) => {
  let release = (_status: number) => {};
  const running = new Promise<number>((resolve) => {
    release = resolve;
  });
  const fixture = await installDayStudyMock(page, {
    words: incompleteDayWords,
    lookup: "assess",
    complete: () => running,
  });
  try {
    await openPlan(page);
    await page.getByRole("button", { name: prepare }).click();
    await expect.poll(() => fixture.requests.complete.length).toBe(1);
    await expect(page.getByRole("progressbar")).toHaveAttribute("value", "1");
    await expect(page.getByRole("button", { name: study })).toBeDisabled();
    await page.getByRole("button", { name: "Hazırlığı iptal et" }).click();
    release(200);
    await expect(
      page.getByText("Hazırlık iptal edildi. Kaydedilen kelimeler korunuyor."),
    ).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("value", "1");
    expect(fixture.requests.saved).toEqual([incompleteDayWords[0].id]);
    expect(fixture.getSession()).toBeUndefined();
    await page.reload();
    await page.getByRole("tab", { name: "Günlük Plan" }).click();
    await expect(page.getByRole("button", { name: study })).toBeEnabled();
  } finally {
    release(200);
  }
});

test("a 502 after saving one word leaves partial progress visible and retry opens the same day", async ({
  page,
}) => {
  const fixture = await installDayStudyMock(page, {
    words: incompleteDayWords,
    lookup: "assess",
    complete: (call) => (call === 1 ? 502 : 200),
  });
  await openPlan(page);
  await page.getByRole("button", { name: prepare }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /Sentetik Gemini hatası \(HTTP 502\)/ }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "1");
  await expect(page.getByRole("button", { name: "Hazır kelimelerle çalış" })).toBeEnabled();
  expect(fixture.requests.saved).toEqual([incompleteDayWords[0].id]);
  expect(fixture.getSession()).toBeUndefined();
  await page.getByRole("button", { name: "Yeniden dene", exact: true }).click();
  await expect(page.getByRole("button", { name: flashcard })).toBeVisible();
  await expect.poll(() => fixture.getSession()?.day).toBe(1);
  expect(fixture.requests.complete).toEqual(Array(2).fill(["Reliable", "Evidence", "Decline"]));
  expect(fixture.requests.saved).toEqual(incompleteDayWords.map((word) => word.id));
});

test("bulk day completion repairs five untiered examples and preserves the already ready word", async ({
  page,
}) => {
  const [first, second, third] = readyDayWords;
  const legacy = {
    ...first,
    examples: first.examples.map(({ difficulty: _difficulty, ...example }) => example),
  };
  const fixture = await installDayStudyMock(page, {
    words: [legacy, second, { ...third, examples: [] }],
  });
  await openPlan(page);
  await page.getByRole("button", { name: "2 eksik kelimeyi AI ile tamamla" }).click();
  await expect(page.getByText("Günün kelime içerikleri tamamlandı.").first()).toBeVisible();
  expect(fixture.requests.complete.flat()).toEqual([first.word, third.word]);
  expect(fixture.getSession()).toBeUndefined();
  expect(fixture.words.find(({ id }) => id === second.id)).toEqual(second);
  const repaired = fixture.words.find(({ id }) => id === first.id);
  expect(repaired?.examples.slice(0, 5).map(({ difficulty }) => difficulty)).toEqual([
    "easy",
    "easy",
    "medium",
    "yds",
    "yds",
  ]);
  expect(repaired?.examples.slice(5)).toEqual(legacy.examples);
  expect(repaired?.meanings).toEqual(first.meanings);
  expect(repaired?.score).toEqual(first.score);
});
