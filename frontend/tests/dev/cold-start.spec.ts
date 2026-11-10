import { expect, test } from "@playwright/test";

test("the first dictionary check on a cold Vite server does not reload the tutorial", async ({
  page,
}) => {
  await page.goto("/#game");
  await page.getByRole("button", { name: "Hazırlık rehberi", exact: true }).click();
  for (let index = 0; index < 5; index++) {
    await expect(page.locator(".driver-popover-title")).toHaveText(
      `Hazırlık rehberi · ${index + 1}/11`,
    );
    await page.getByRole("button", { name: "Anladım, devam et" }).click();
  }
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await expect(page.locator("#import-check")).toHaveAttribute("type", "button");
  await page.locator("#import-check").click();
  await expect(page.locator(".driver-popover-title")).toHaveText("Hazırlık rehberi · 7/11");
  await page.waitForLoadState("networkidle");
  expect(navigations).toBe(0);
  await page.locator("#import-suggestion").click();
  await page.locator("#import-accept").click();
  await expect(page.locator(".driver-popover-title")).toHaveText("Hazırlık rehberi · 9/11");
  expect(await page.evaluate(() => localStorage.getItem("yds-atlas-words-v1"))).toBeNull();
});
