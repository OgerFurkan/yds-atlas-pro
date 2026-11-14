import { expect, test } from "@playwright/test";

test("cloud sync preview is available to guests but never starts a cloud request", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/account/daily-plan**", async (route) => {
    requests += 1;
    await route.abort();
  });
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await page.getByRole("button", { name: "Senkronizasyon önizlemesi" }).click();
  const dialog = page.getByRole("dialog", { name: "Bulut planı karşılaştırması" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Sadece okuma", { exact: false })).toBeVisible();
  await expect(dialog.getByText("hesabına giriş yapmalısın", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Planları karşılaştır" })).toHaveCount(0);
  expect(requests).toBe(0);
});
