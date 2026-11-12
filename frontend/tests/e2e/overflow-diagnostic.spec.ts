import { expect, test, type Page } from "@playwright/test";

async function logOverflow(page: Page, state: string) {
  const report = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const width = document.documentElement.scrollWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className).slice(0, 160),
          text: (element.textContent ?? "").trim().slice(0, 50),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          display: style.display,
          visibility: style.visibility,
        };
      })
      .filter((item) => item.display !== "none" && item.visibility !== "hidden")
      .filter((item) => item.right > viewport + 1 || item.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 12);
    return { viewport, scrollWidth: width, overflow: width - viewport, offenders };
  });
  console.log(`[OVERFLOW][${state}] ${JSON.stringify(report, null, 2)}`);
  expect(report.scrollWidth, `${state}: yatay tasma var; yukaridaki elemanlari kontrol et`).toBeLessThanOrEqual(report.viewport + 1);
}

test("diagnose horizontal overflow across key pages", async ({ page }) => {
  for (const width of [320, 375, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/#library");
    await logOverflow(page, `library-${width}px`);
    await page.getByRole("tab", { name: /Günlük Plan/ }).click();
    await logOverflow(page, `daily-plan-${width}px`);
    await page.goto("/#game");
    await logOverflow(page, `game-setup-${width}px`);
  }
});
