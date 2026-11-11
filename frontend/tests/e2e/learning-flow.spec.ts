import { expect, type Page, test } from "@playwright/test";

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
  await page.goto("/");
  await page.getByRole("button", { name: "Hedefe Başla" }).click();
  await expect(page.getByRole("heading", { name: "Günlük Görev", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Günlük göreve başla", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tekrar göreyim" })).toHaveCount(0);
  await page.getByRole("button", { name: "Kartı çevir ve anlamı göster" }).click();
  await expect(page.locator("#word-example p")).toHaveCount(3);
  await expect(page.locator("#word-example strong.italic").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "UK telaffuzunu dinle" })).toBeVisible();
  await page.screenshot({
    path: `test-results/card-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Bir sonraki kelime", exact: true }).click();
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
        await page.locator(`[data-matching-side="left"][data-word-id="${id}"]`).click();
        await page.locator(`[data-matching-side="right"][data-word-id="${id}"]`).click();
      }
      await page.locator("#matching-next").click();
    } else {
      await page.locator("#choice-correct").click();
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
  }
  expect(iterations).toBeLessThan(130);
  await expect(page.getByRole("heading", { name: "Bugün kendine bir adım kattın." })).toBeVisible();
  await expect(
    page.getByText("Kelime grupların ve günlük ilerlemen güncellendi.", { exact: true }),
  ).toBeVisible();
  const scores = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yds-atlas-words-v1") ?? "[]").map(
      (word: { score: number }) => word.score,
    ),
  );
  expect(scores).toEqual(Array(20).fill(100));
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
        path: `test-results/tutorial-${test.info().project.name}.png`,
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
