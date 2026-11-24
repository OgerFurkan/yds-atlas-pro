import type { Locator } from "@playwright/test";
import { expect, test } from "../../../frontend/playwright-test";
import { readyDayWords } from "../fixtures/day-study-words";

async function contrast(locator: Locator, focus = false) {
  return locator.evaluate((element, focus) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    const style = getComputedStyle(element);
    const layers = [];
    for (let node = focus ? element.parentElement : element; node; node = node.parentElement)
      layers.unshift(getComputedStyle(node).backgroundColor);
    const colors = ["#fff", ...layers, focus ? style.outlineColor : style.color];
    const luminance = colors.map((color) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data, (value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    });
    const foreground = luminance.at(-1) ?? 0;
    const background = luminance.at(-2) ?? 0;
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  }, focus);
}

for (const theme of ["light", "dark"] as const) {
  test(`daily controls maintain contrast and keyboard focus in ${theme}`, async ({
    page,
    isMobile,
  }) => {
    await page.addInitScript(
      ({ theme, word }) => {
        localStorage.setItem("yds-atlas-theme", theme);
        localStorage.setItem("yds-atlas-words-v1", JSON.stringify([word]));
      },
      { theme, word: readyDayWords[0] },
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#library");
    await page.getByRole("tab", { name: "Günlük Plan" }).click();
    const study = page.getByRole("button", { name: "1. günün kelimeleriyle çalış" });
    await expect(study).toBeEnabled();
    const studyContrast = await contrast(study);
    expect(studyContrast).toBeGreaterThanOrEqual(4.5);
    if (!isMobile) {
      await study.hover();
      expect(await contrast(study)).toBeGreaterThanOrEqual(4.5);
      await page.mouse.move(0, 0);
    }
    await page.getByRole("button", { name: "1. günün kelimelerini puansız tekrar et" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(study).toBeFocused();
    await expect(study).toHaveCSS("outline-style", "solid");
    const studyFocusContrast = await contrast(study, true);
    expect(studyFocusContrast).toBeGreaterThanOrEqual(3);
    const open = page.locator("#daily-day-1-open");
    await open.press("Enter");
    const dialog = page.getByRole("dialog", { name: "1. Gün · Kelimeler" });
    const trigger = dialog.getByRole("combobox").filter({ hasText: "1. Gün" });
    const triggerContrast = await contrast(trigger);
    expect(triggerContrast).toBeGreaterThanOrEqual(4.5);
    await trigger.focus();
    await expect(trigger).toHaveCSS("outline-style", "solid");
    const triggerFocusContrast = await contrast(trigger, true);
    expect(triggerFocusContrast).toBeGreaterThanOrEqual(3);
    await trigger.press("ArrowDown");
    const list = page.getByRole("listbox");
    const selected = list.getByRole("option", { name: "1. Gün", exact: true });
    await expect(selected).toHaveAttribute("aria-selected", "true");
    const selectedContrast = await contrast(selected);
    expect(selectedContrast).toBeGreaterThanOrEqual(4.5);
    await expect(list.getByRole("option", { name: "2. Gün", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const next = list.getByRole("option", { name: "3. Gün", exact: true });
    await expect(next).toBeFocused();
    await expect(next).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 0,
    );
    console.log(
      `${theme}: Study ${studyContrast.toFixed(2)}, day trigger ${triggerContrast.toFixed(2)}, selected option ${selectedContrast.toFixed(2)}, focus ${studyFocusContrast.toFixed(2)} / ${triggerFocusContrast.toFixed(2)}`,
    );
  });
}
