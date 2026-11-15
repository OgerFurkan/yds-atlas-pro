import { expect, test } from "@playwright/test";

/** Local preview, guest account. Never points at production/staging external data. */
test("progress is navigable, calendar edits persist, and manual done is not scored", async ({ page }) => {
  await page.goto("/#progress");
  await expect(page.getByTestId("progress-calendar-page")).toBeVisible();
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Takvim etkinliği düzenle" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Başlık" }).fill("YDS 15 dakikalık okuma");
  await dialog.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("YDS 15 dakikalık okuma").first()).toBeVisible();
  await page.getByRole("button", { name: "Yapıldı" }).click();
  await expect(page.getByText("Elle tamamlandı").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("YDS 15 dakikalık okuma").first()).toBeVisible();
  // A calendar status never fabricates a completed game in the local progress ledger.
  const scores = await page.evaluate(() => localStorage.getItem("yds-atlas-daily-progress-v1"));
  expect(scores === null || scores === "{}").toBeTruthy();
});

test("coach clearly explains evidence limits on mobile", async ({ page }) => {
  await page.goto("/#progress");
  await expect(page.getByRole("heading", { name: "Bugün neye çalışmalısın?" })).toBeVisible();
  await expect(page.getByText(/kural tabanlıdır/)).toBeVisible();
  await expect(page.getByText(/Bir oturum puanı kalıcı öğrenme değildir/)).toBeVisible();
});
