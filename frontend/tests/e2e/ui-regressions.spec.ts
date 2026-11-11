import { expect, type Page, test } from "@playwright/test";
import { installSpeechMock } from "../helpers/speech-mock";

async function openPronunciationStep(page: Page) {
  await page.goto("/#game");
  await page.getByRole("button", { name: "Oyunu dene", exact: true }).click();
  await page.getByRole("button", { name: "Anladım, devam et" }).click();
  await page.locator("#atlas-card-flip").click();
  await page.getByRole("button", { name: "Anladım, devam et" }).click();
  await expect(page.locator(".driver-popover[data-guide-step=turn-front]")).toBeVisible();
  await page.locator("#atlas-card-flip").click();
  await expect(page.locator(".driver-popover[data-guide-step=turn-back]")).toBeVisible();
  await page.locator("#atlas-card-flip").click();
  await expect(page.locator(".driver-popover-title")).toHaveText("Oyun rehberi · 6/28");
}

test("source tabs stay inside their track and desktop preparation panels align", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/#game");
    for (const source of ["Hazır liste", "Kütüphanem", "Kendi listem"]) {
      await page.getByRole("tab", { name: source, exact: true }).click();
      const track = await page.locator("#task-sources").boundingBox();
      for (const tab of await page.locator("#task-sources [role=tab]").all()) {
        const box = await tab.boundingBox();
        expect(box!.y).toBeGreaterThanOrEqual(track!.y + 2);
        expect(box!.y + box!.height).toBeLessThanOrEqual(track!.y + track!.height - 2);
      }
      if (width >= 1024) {
        const left = await page.locator("#task-configuration").boundingBox();
        const right = await page.locator("#task-summary").boundingBox();
        expect(Math.abs(left!.y - right!.y)).toBeLessThan(1);
        expect(Math.abs(left!.height - right!.height)).toBeLessThan(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
});

test("pronunciation guide points to the button and advances only when listening finishes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installSpeechMock(page, false);
  await openPronunciationStep(page);
  await expect
    .poll(async () => {
      const button = await page.locator("#pronunciation-uk").boundingBox();
      const cursor = await page.getByTestId("guide-cursor").boundingBox();
      return cursor && button
        ? Math.abs(cursor.x + 5 - button.x - button.width / 2) +
            Math.abs(cursor.y + 4 - button.y - button.height / 2)
        : 999;
    })
    .toBeLessThan(2);
  await page.locator("#pronunciation-uk").click();
  await expect(page.locator("#pronunciation-uk")).toHaveAttribute(
    "aria-label",
    "UK telaffuzunu durdur",
  );
  await expect(page.locator(".driver-popover-title")).toHaveText("Oyun rehberi · 6/28");
  await page.locator("#pronunciation-uk").click();
  await expect(page.locator(".driver-popover-title")).toHaveText("Oyun rehberi · 6/28");
  await page.locator("#pronunciation-us").click();
  await page.evaluate(() =>
    (window as unknown as { __speechMock: { finish: () => void } }).__speechMock.finish(),
  );
  await expect(page.locator(".driver-popover-title")).toHaveText("Oyun rehberi · 7/28");
  await expect(page.locator("#word-example p").last().locator("strong.italic")).toHaveText(
    "genişletmeyi",
  );
});

test("a speech failure stays on the guide step with an explicit accessible fallback", async ({
  page,
}) => {
  await installSpeechMock(page, false);
  await openPronunciationStep(page);
  await page.locator("#pronunciation-uk").click();
  await page.evaluate(() =>
    (window as unknown as { __speechMock: { fail: () => void } }).__speechMock.fail(),
  );
  await expect(page.locator(".driver-popover-title")).toHaveText("Oyun rehberi · 6/28");
  await expect(page.getByRole("status")).toContainText("İngilizce ses oynatılamadı");
  await page.getByRole("button", { name: "Bu adımı sessiz geç" }).click();
  await expect(page.locator(".driver-popover-title")).toHaveText("Oyun rehberi · 7/28");
});

test("a first dictionary download failure can be retried without losing the preparation guide", async ({
  page,
  context,
}) => {
  let attempts = 0;
  await context.route("**/dictionaries/en.dic", (route) =>
    ++attempts === 1 ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue(),
  );
  await page.goto("/#game");
  await page.getByRole("button", { name: "Hazırlık rehberi", exact: true }).click();
  for (let index = 0; index < 5; index++) {
    await expect(page.locator(".driver-popover-title")).toHaveText(
      `Hazırlık rehberi · ${index + 1}/11`,
    );
    await page.getByRole("button", { name: "Anladım, devam et" }).click();
  }
  await page.locator("#import-check").click();
  await expect(page.getByRole("alert")).toContainText("Yazım denetimi yüklenemedi");
  await expect(page.locator(".driver-popover-title")).toHaveText("Hazırlık rehberi · 6/11");
  await page.locator("#import-check").click();
  await expect(page.locator(".driver-popover-title")).toHaveText("Hazırlık rehberi · 7/11");
  expect(attempts).toBe(2);
});

test("Atlas introduces himself next to the daily goal on desktop and mobile", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("figure", { name: "Atlas, YDS Atlas maskotu ve öğrenme arkadaşın" }),
  ).toBeVisible();
  await expect(page.getByText("Ben Atlas, öğrenme arkadaşın!", { exact: true })).toBeVisible();
  await expect(page.getByText("YDS Atlas'ın maskotu", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("appearance and language preferences persist and library cards stay distinct in dark mode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "yds-atlas-words-v1",
      JSON.stringify(
        [
          ["preference-hard", "Zebra", 30],
          ["preference-review", "Quokka", 60],
          ["preference-learned", "Walrus", 90],
          ...Array.from({ length: 18 }, (_, index) => [
            `preference-hard-${index}`,
            `Practice${index}`,
            30,
          ]),
        ].map(([id, word, score]) => ({
          id,
          word,
          alternatives: [],
          meanings: ["Test meaning"],
          usageNote: "Test usage.",
          partOfSpeech: "Noun",
          cefr: "B2",
          score,
          examples: Array.from({ length: 5 }, (_, index) => ({
            sentence: `The ${word} appears in context ${index}.`,
            translation: `Çeviri ${word}-${index}.`,
            translationFocus: [`Çeviri ${word}`],
          })),
          pronunciationUk: "",
          pronunciationUs: "",
          sourceUrl: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      ),
    );
  });
  await page.goto("/");
  await expect(page).toHaveTitle("YDS Atlas Pro | YDS Kelime Öğrenme");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/atlas-pro-mark.svg");
  await page.getByRole("button", { name: "Menüyü aç" }).click();
  await page.getByRole("button", { name: "Ayarlar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Görünüm ve dil" })).toBeVisible();
  const title = await dialog.getByRole("heading").boundingBox();
  const close = await dialog.getByRole("button", { name: "Pencereyi kapat" }).boundingBox();
  expect(title!.x + title!.width).toBeLessThan(close!.x);

  await dialog.getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveTitle("YDS Atlas Pro | YDS Vocabulary Coach");
  await expect(dialog.getByRole("heading", { name: "Appearance and language" })).toBeVisible();
  await dialog.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Where would you like to start today?" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: `test-results/preferences-${test.info().project.name}.png`,
    fullPage: true,
  });

  await page.goto("/#library");
  const card = page.locator(".library-word-card");
  await expect(card).toHaveCount(21);
  for (const [word, background, color] of [
    ["Zebra", "rgb(56, 40, 31)", "rgb(255, 192, 149)"],
    ["Quokka", "rgb(56, 49, 31)", "rgb(247, 217, 139)"],
    ["Walrus", "rgb(29, 56, 46)", "rgb(167, 220, 195)"],
  ]) {
    const badge = page
      .locator(".library-word-card")
      .filter({ hasText: word })
      .locator("span.inline-flex.min-h-7");
    await expect(badge).toBeVisible();
    expect(await badge.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      background,
    );
    expect(await badge.evaluate((element) => getComputedStyle(element).color)).toBe(color);
  }
  await page.screenshot({
    path: `test-results/library-grid-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(await card.first().evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe(
    "1px",
  );
  expect(await card.first().evaluate((element) => getComputedStyle(element).borderTopColor)).toBe(
    "rgb(83, 99, 107)",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  if (test.info().project.name === "desktop") {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("checkbox", { name: "Select Zebra" }).click();
    const row = page.locator('tr.word-table-row[data-selected="true"]');
    await expect(row).toHaveAttribute("data-selected", "true");
    await expect(row).toHaveClass(/is-selected/);
    expect(await row.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      "rgb(58, 49, 32)",
    );
  } else {
    const mobileCard = page.locator(".library-word-card").first();
    await mobileCard.getByRole("checkbox", { name: "Select Zebra" }).click();
    await expect(mobileCard).toHaveAttribute("data-selected", "true");
    await expect(mobileCard).toHaveClass(/is-selected/);
    expect(await mobileCard.evaluate((card) => getComputedStyle(card).backgroundColor)).toBe(
      "rgb(58, 49, 32)",
    );
  }

  await page.goto("/#home");
  await page.getByRole("button", { name: "Start goal" }).click();
  await page.getByRole("button", { name: "Start daily task" }).click();
  await page.locator("#atlas-card-flip").click();
  const cardBack = page.locator("#word-information");
  await expect(cardBack).toBeVisible();
  expect(await cardBack.evaluate((element) => getComputedStyle(element).color)).toBe(
    "rgb(18, 59, 89)",
  );
});

test("dark answer feedback keeps red and green states readable", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yds-atlas-theme", "dark");
    localStorage.setItem("yds-atlas-language", "en");
    const now = new Date().toISOString();
    localStorage.setItem(
      "yds-atlas-words-v1",
      JSON.stringify(
        Array.from({ length: 20 }, (_, index) => ({
          id: `feedback-word-${index}`,
          word: `feedbackword${index}`,
          alternatives: [],
          meanings: [`Feedback meaning ${index}`],
          usageNote: "Practice usage.",
          partOfSpeech: "Noun",
          cefr: "B2",
          score: 20,
          examples: Array.from({ length: 5 }, (_, exampleIndex) => ({
            sentence: `The feedbackword${index} appears in context ${exampleIndex}.`,
            translation: `Çeviri ${index}-${exampleIndex}.`,
            translationFocus: [`Çeviri ${index}`],
          })),
          pronunciationUk: "",
          pronunciationUs: "",
          sourceUrl: "",
          createdAt: now,
          updatedAt: now,
        })),
      ),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start goal" }).click();
  await page.getByRole("button", { name: "Start daily task" }).click();

  for (let index = 0; index < 5; index++) {
    await page.locator("#atlas-card-flip").click();
    await page.locator("#flashcard-next").click();
  }
  const session = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yds-atlas-learning-session-v2") ?? "null"),
  );
  for (const id of session.matching.left as string[]) {
    await page.locator(`[data-matching-side="left"][data-word-id="${id}"]`).click();
    await page.locator(`[data-matching-side="right"][data-word-id="${id}"]`).click();
  }
  await page.locator("#matching-next").click();
  await page.locator("#choice-wrong").click();
  const feedback = page.locator("#answer-feedback");
  await expect(feedback).toBeVisible();
  expect(await feedback.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    "rgb(59, 37, 37)",
  );
  expect(
    await feedback.locator(".text-red-900").evaluate((element) => getComputedStyle(element).color),
  ).toBe("rgb(255, 170, 163)");
  const comparison = feedback.locator(".flex.flex-wrap.gap-x-6.gap-y-2");
  expect(await comparison.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    "rgb(38, 52, 61)",
  );
  expect(
    await comparison
      .locator(".text-slate-500")
      .evaluate((element) => getComputedStyle(element).color),
  ).toBe("rgb(167, 181, 188)");
  await page.locator("#question-next").click();
  await page.locator("#choice-correct").click();
  expect(await feedback.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    "rgb(29, 56, 46)",
  );
  expect(
    await feedback
      .locator(".text-emerald-900")
      .evaluate((element) => getComputedStyle(element).color),
  ).toBe("rgb(167, 220, 195)");
});

test("Atlas chat opens as a branded assistant and asks guests to sign in before sending", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("yds-atlas-theme", "dark"));
  await page.goto("/");
  await page.getByRole("button", { name: "Atlas'a sor" }).click();
  const chat = page.getByRole("dialog", { name: "YDS Atlas Pro Asistanı" });
  await expect(chat).toBeVisible();
  expect(
    await chat.locator("form").evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: "Atlas'a sor" })).toHaveCount(0);
  await page.screenshot({
    path: `test-results/atlas-chat-${test.info().project.name}.png`,
    fullPage: true,
  });
  await expect(
    chat.getByText("Merhaba! Bir kelime, çeviri veya YDS sorusu sorabilirsin."),
  ).toBeVisible();
  await chat.getByRole("button", { name: "Indicate ne demek?" }).click();
  await expect(chat.getByText("Atlas ile sohbet etmek için hesabına giriş yap.")).toBeVisible();
  await chat.getByRole("button", { name: /YDS Atlas AI/ }).click();
  await chat.getByRole("button", { name: "Yeni sohbet" }).click();
  await expect(
    chat.getByRole("heading", { name: "Merhaba, nasıl yardımcı olabilirim?" }),
  ).toBeVisible();
  await chat.getByRole("button", { name: /YDS Atlas AI/ }).click();
  await chat.getByRole("button", { name: "Sohbet geçmişi" }).click();
  await chat.getByRole("button", { name: "Indicate ne demek?" }).click();
  await expect(chat.getByText("Indicate ne demek?", { exact: true })).toBeVisible();
  await chat.getByRole("button", { name: /YDS Atlas AI/ }).click();
  await chat.getByRole("button", { name: "Yeni sohbet" }).click();
  await chat.getByRole("button", { name: "Indicate ne demek?" }).click();
  await expect(chat.getByText("Atlas ile sohbet etmek için hesabına giriş yap.")).toBeVisible();
  await chat.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/#login$/);
});

test("notifications include Atlas branding and an explicit dismiss button", async ({ page }) => {
  await page.goto("/");
  if (test.info().project.name === "mobile")
    await page.getByRole("button", { name: "Menüyü aç" }).click();
  await page.getByRole("button", { name: "Pratik", exact: true }).click();
  const toast = page.locator(".Toastify__toast.atlas-toast");
  await expect(toast).toBeVisible();
  await page.screenshot({
    path: `test-results/atlas-toast-${test.info().project.name}.png`,
    fullPage: true,
  });
  await expect(toast.locator(".atlas-toast-avatar img")).toHaveAttribute(
    "src",
    "/brand/atlas-mascot.png",
  );
  await toast.getByRole("button", { name: "Bildirimi kapat" }).click();
  await expect(toast).toHaveCount(0);
});
