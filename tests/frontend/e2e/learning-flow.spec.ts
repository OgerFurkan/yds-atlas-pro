import { expect, type Page, test } from "../../../frontend/config/playwright/test-fixtures";
import { readyDayWords } from "../fixtures/day-study-words";
import { installSpeechMock } from "../helpers/speech-mock";

const sessionKey = "yds-atlas-learning-session-v2";
async function sessionState(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), sessionKey);
}
async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test("a quota failure keeps the selected day available for a local retry", async ({ page }) => {
  await page.goto("/#library");
  await page.evaluate(
    (words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)),
    readyDayWords,
  );
  await page.reload();
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.evaluate((sessionKey) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === sessionKey) {
        Storage.prototype.setItem = original;
        throw new DOMException("Test storage full", "QuotaExceededError");
      }
      original.call(this, key, value);
    };
  }, sessionKey);
  await page.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await expect(page.getByText(/Tarayıcı kaydı yapılamadı/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ara ver" })).toHaveCount(0);
  await expect(page.getByText(/ancak buluta kaydedilemedi/)).toHaveCount(0);
  expect(await sessionState(page)).toBeNull();
  await page.getByRole("button", { name: "Çalış", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ara ver" })).toBeVisible();
  expect((await sessionState(page)).day).toBe(1);
});

test("discard confirmation preserves progress made in another tab on the same task", async ({
  page,
  context,
}) => {
  await page.goto("/#library");
  await page.evaluate(
    (words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)),
    readyDayWords,
  );
  await page.reload();
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await page.getByRole("button", { name: "Görevi iptal et" }).click();
  const confirmation = page.getByRole("alertdialog");
  const original = await sessionState(page);
  const second = await context.newPage();
  await second.goto("/#game");
  await second.getByRole("button", { name: "Kaldığım yerden devam et" }).click();
  await second.getByRole("button", { name: "Kartı çevir ve anlamı göster" }).click();
  await second.getByRole("button", { name: "Bir sonraki kelime", exact: true }).click();
  await expect.poll(() => sessionState(second)).not.toEqual(original);
  const newer = await sessionState(second);
  expect(newer.id).toBe(original.id);
  await confirmation.getByRole("button", { name: "Çalışmayı sonlandır" }).click();
  await expect(confirmation.getByRole("alert")).toContainText("Görev başka bir oturumda değişti");
  expect(await sessionState(page)).toEqual(newer);
});

test("library maintenance never offers or starts retired personal sentence backfill", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    localStorage.setItem(
      "yds-atlas-words-v1",
      JSON.stringify([
        {
          id: "legacy-consent-word",
          word: "Abandon",
          meanings: ["terk etmek"],
          alternatives: [],
          usageNote: "",
          partOfSpeech: "Verb",
          cefr: "B1",
          score: 0,
          examples: [],
          pronunciationUk: "",
          pronunciationUs: "",
          sourceUrl: "",
          createdAt: now,
          updatedAt: now,
        },
      ]),
    );
  });
  let posted = 0;
  await page.route("**/api/lexicon/tooltip/backfill", (route) => {
    posted++;
    return route.fulfill({ status: 410, json: { code: "TOOLTIP_BACKFILL_RETIRED" } });
  });
  await page.goto("/#library");
  const recovery = page.locator("#library-word-controls details");
  await expect(recovery.locator("summary")).toContainText("Gelişmiş kütüphane bakımı");
  const start = page.getByRole("button", { name: "Eski cümleleri sözlüğe ekle" });
  await expect(start).toHaveCount(0);
  expect(posted).toBe(0);
  await recovery.locator("summary").click();
  await expect(start).toHaveCount(0);
  expect(posted).toBe(0);
});

test("single and bulk imports normalize words, review spelling and skip duplicates", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Kelime ekle", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", { name: /İngilizce kelime/ });
  await input.fill("  ABANDON  ");
  await input.press("Tab");
  await expect(input).toHaveValue("Abandon");
  await dialog.getByRole("button", { name: "Kütüphaneye ekle" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Abandon kelimesini düzenle" })).toBeVisible();
  await page.getByRole("button", { name: "Toplu ekle", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "İngilizce kelime listesi" })
    .fill("benefit; benifit; CONSEQUENCE; benefit");
  await dialog.getByRole("button", { name: "Yazımı kontrol et" }).click();
  await expect(dialog.getByText("Sözlükte bulunamadı.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Benefit", exact: true }).click();
  await dialog.getByRole("button", { name: /Kelimeleri ekle/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("yds-atlas-words-v1") ?? "[]").length),
    )
    .toBe(3);
  await page.getByRole("button", { name: "Abandon kelime ayrıntıları" }).click();
  await expect(page.getByRole("dialog").getByText(/Mürettebat/)).toBeVisible();
  await page.getByRole("button", { name: "Pencereyi kapat" }).click();
  for (const width of [320, 390, 768, 1024, 1170, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoOverflow(page);
  }
});

test("daily task survives reload, shows translated cards and automatically saves groups", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (localStorage.getItem("yds-atlas-words-v1") !== null) return;
    const now = new Date().toISOString();
    const words = Array.from({ length: 20 }, (_, index) => ({
      id: `library-word-${index}`,
      word: `atlasword${index}`,
      meanings: [`Test meaning ${index}`],
      alternatives: [],
      usageNote: "Test usage note.",
      partOfSpeech: "Noun",
      cefr: "B2",
      score: index < 5 ? 20 : 60,
      examples: Array.from({ length: 5 }, (_, exampleIndex) => ({
        sentence: `The atlasword${index} appears in test context ${exampleIndex}.`,
        translation: `Test translation ${index}-${exampleIndex}.`,
        translationFocus: [`Test translation ${index}`],
      })),
      pronunciationUk: "",
      pronunciationUs: "",
      sourceUrl: "",
      createdAt: now,
      updatedAt: now,
    }));
    localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Hedefe Başla" }).click();
  await expect(page.getByRole("heading", { name: "Günlük Görev", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Günlük göreve başla", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tekrar göreyim" })).toHaveCount(0);
  await page.getByRole("button", { name: "Kartı çevir ve anlamı göster" }).click();
  await expect(page.locator("#word-example p")).toHaveCount(3);
  await expect(page.locator("#word-example strong.italic").first()).toBeVisible();
  // Revealed card examples expose local Turkish word tooltips without spoiling
  // the unflipped front; this exercises real desktop and mobile browsers.
  await expect(page.locator('#word-example [data-testid="sentence-word"]').first()).toBeVisible();
  await page.locator('#word-example [data-testid="sentence-word"]').first().click();
  const tooltip = page.getByTestId("sentence-word-definition");
  await expect(tooltip).toBeVisible();
  const bounds = await tooltip.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1440);
  await page.locator('#word-example [data-testid="sentence-word"]').first().click();
  await expect(page.getByRole("button", { name: "UK telaffuzunu dinle" })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath(`card-${test.info().project.name}.png`),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Bir sonraki kelime", exact: true }).click();
  await expect.poll(async () => (await sessionState(page)).queue.length).toBe(4);
  const before = await sessionState(page);
  await page.reload();
  await page.getByRole("button", { name: "Kaldığım yerden devam et" }).click();
  expect((await sessionState(page)).queue).toEqual(before.queue);
  let iterations = 0;
  let reloaded = false;
  while (iterations++ < 130) {
    const session = await sessionState(page);
    if (session.phase === "complete") break;
    if (session.phase === "flashcards") {
      await page.getByRole("button", { name: "Kartı çevir ve anlamı göster" }).click();
      await page.getByRole("button", { name: "Bir sonraki kelime", exact: true }).click();
    } else if (session.phase.endsWith("matching")) {
      const ids: string[] = session.matching.left;
      for (const id of ids) {
        const index = id.slice("library-word-".length);
        await page
          .locator("#matching-board")
          .getByText("atlasword" + index, { exact: true })
          .click();
        await page
          .locator("#matching-board")
          .getByText("Test meaning " + index, { exact: true })
          .click();
      }
      await page.locator("#matching-next").click();
    } else {
      // The hidden target in a cloze never becomes a tooltip, but surrounding
      // vocabulary can be inspected without revealing the correct answer.
      if (session.phase.includes("context")) {
        await expect(
          page.locator('#question-sentence [data-testid="sentence-word"]').first(),
        ).toBeVisible();
      } else {
        await expect(page.locator('#question-sentence [data-testid="sentence-word"]')).toHaveCount(
          0,
        );
      }
      const fixtureIndex = session.queue[0].slice("library-word-".length);
      const answer =
        (session.phase.endsWith("context") ? "atlasword" : "Test meaning ") + fixtureIndex;
      await page.locator("#question-choices").getByText(answer, { exact: true }).click();
      // After feedback, every displayed English token can expose a tooltip.
      await expect(
        page.locator('#question-sentence [data-testid="sentence-word"]').first(),
      ).toBeVisible();
      await expect(
        page.locator('#answer-feedback [data-testid="sentence-word"]').first(),
      ).toBeVisible();
      if (!reloaded) {
        const answered = await sessionState(page);
        await page.reload();
        await page.getByRole("button", { name: "Kaldığım yerden devam et" }).click();
        expect((await sessionState(page)).answer).toEqual(answered.answer);
        reloaded = true;
      }
      if (session.phase.startsWith("final-"))
        await page.getByRole("button", { name: "Kolay hatırladım", exact: true }).click();
      await expect(page.getByRole("main")).not.toContainText(/puan|sıranın sonuna/i);
      await page.getByRole("button", { name: "Devam et", exact: true }).click();
    }
    await expect
      .poll(async () => {
        const next = await sessionState(page);
        return (
          next.phase !== session.phase ||
          JSON.stringify(next.queue) !== JSON.stringify(session.queue)
        );
      })
      .toBe(true);
  }
  expect(iterations).toBeLessThan(130);
  await expect(page.getByRole("heading", { name: "Bugün kendine bir adım kattın." })).toBeVisible();
  await expect(
    page.getByText("Puansız pratik tamamlandı. Kelime puanların korundu.", { exact: true }).first(),
  ).toBeVisible();
  const scores = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yds-atlas-words-v1") ?? "[]").map(
      (word: { score: number }) => word.score,
    ),
  );
  expect(scores).toEqual([...Array(5).fill(20), ...Array(15).fill(60)]);
  await page.goto("/#home");
  await expect(page.getByRole("progressbar", { name: "Günlük kelime hedefi" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await expect(page.getByRole("complementary", { name: "Günlük çalışma serisi" })).toContainText(
    "1",
  );
  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("spotlight game tutorial requires actions and preserves real data", async ({ page }) => {
  await installSpeechMock(page);
  await page.goto("/#game");
  await page.getByRole("button", { name: "Oyunu dene", exact: true }).click();
  const actions = [
    "info",
    "flip",
    "info",
    "flip",
    "flip",
    "pronounce",
    "info",
    "next-card",
    "wrong",
    "info",
    "next",
    "correct",
    "info",
    "next",
    "info",
    "correct",
    "next",
    "info",
    "matching-left",
    "matching-right",
    "info",
    "matching-next",
    "correct",
    "confidence",
    "next",
    "correct",
    "confidence",
    "next",
  ];
  for (const [index, action] of actions.entries()) {
    await expect(page.locator(".driver-popover-title")).toHaveText(
      `Oyun rehberi · ${index + 1}/28`,
    );
    if (action === "info") await page.getByRole("button", { name: "Anladım, devam et" }).click();
    else if (action === "flip") await page.locator("#atlas-card-flip").click();
    else if (action === "pronounce")
      await page.getByRole("button", { name: "UK telaffuzunu dinle" }).click();
    else if (action === "next-card") await page.locator("#flashcard-next").click();
    else if (action === "wrong") await page.locator("#choice-wrong").click();
    else if (action.startsWith("matching-")) await page.locator(`#${action}`).click();
    else if (action === "correct") await page.locator("#choice-correct").click();
    else if (action === "confidence")
      await page.getByRole("button", { name: "Kolay hatırladım", exact: true }).click();
    else await page.locator("#question-next").click();
    if (index === 9)
      await page.screenshot({
        path: test.info().outputPath(`tutorial-${test.info().project.name}.png`),
        fullPage: true,
      });
  }
  await expect(page.getByText("OYUN REHBERİ TAMAMLANDI", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("yds-atlas-words-v1"))).toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), sessionKey)).toBeNull();
  await expectNoOverflow(page);
});

test("preparation tutorial types, checks and corrects a demo list without saving it", async ({
  page,
}) => {
  await page.goto("/#game");
  await page.getByRole("button", { name: "Hazırlık rehberi", exact: true }).click();
  for (let index = 0; index < 11; index++) {
    await expect(page.locator(".driver-popover-title")).toHaveText(
      `Hazırlık rehberi · ${index + 1}/11`,
    );
    if (index === 5) await page.locator("#import-check").click();
    else if (index === 6) await page.locator("#import-suggestion").click();
    else if (index === 7) await page.locator("#import-accept").click();
    else if (index === 9) await page.locator("#task-batch-10").click();
    else
      await page
        .getByRole("button", { name: index === 10 ? "Rehberi bitir" : "Anladım, devam et" })
        .click();
  }
  await expect(page.locator(".driver-popover")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("yds-atlas-words-v1"))).toBeNull();
  await page.getByRole("button", { name: "Oyunu dene", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".driver-popover")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Günlük Görev", exact: true })).toBeVisible();
});

test("navigation and daily goal settings fit narrow and intermediate viewports", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1024, 1170, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expectNoOverflow(page);
    await page.goto("/#game");
    await expect(page.getByRole("heading", { name: "Günlük Görev", exact: true })).toBeVisible();
    await expectNoOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Hedefi düzenle" }).click();
  await page.getByRole("button", { name: "Hedefi 10 azalt" }).click();
  await expect(page.getByRole("dialog").locator("output")).toContainText("10");
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await page.getByRole("button", { name: "Menüyü aç" }).click();
  await page.getByRole("button", { name: "Öğren", exact: true }).click();
  await page.getByRole("menuitem", { name: /Günlük Görev/ }).click();
  await expect(page.getByRole("heading", { name: "Günlük Görev", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Kütüphanem", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Günlük göreve başla", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/Hedefin için 10 hazır kelime daha gerekiyor/)).toBeVisible();
  await expectNoOverflow(page);
});
