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


test("guest coach clearly discloses limited evidence and never claims server-verified results", async ({ page }) => {
  await page.goto("/#progress");
  await expect(page.getByText(/Misafir koçu yalnız yerel kelime puanları/)).toBeVisible();
  await expect(page.getByText(/kalıcı öğrenme kanıtı hesaplanmaz/)).toBeVisible();
  await expect(page.getByText(/Sunucunun doğruladığı günlük kelime/)).toHaveCount(0);
});

test("calendar retains unsaved draft on local storage error", async ({ page }) => {
  await page.addInitScript(() => {
    const previous = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.includes("atlas-progress-calendar-v1")) throw new Error("Simulated calendar storage failure");
      return previous.call(this, key, value);
    };
  });
  await page.goto("/#progress");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Takvim etkinliği düzenle" });
  const title = editor.getByRole("textbox", { name: "Başlık" });
  await title.fill("Silinmemesi gereken taslak");
  await editor.getByRole("button", { name: "Kaydet" }).click();
  await expect(editor).toBeVisible();
  await expect(title).toHaveValue("Silinmemesi gereken taslak");
  await expect(editor.getByRole("alert")).toContainText("Simulated calendar storage failure");
});
