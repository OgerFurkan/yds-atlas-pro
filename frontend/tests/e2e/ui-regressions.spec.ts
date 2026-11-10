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
