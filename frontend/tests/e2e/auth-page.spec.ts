import { expect, test } from "@playwright/test";
test("login page opens from the header, supports auth modes and returns to guest use", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page).toHaveURL(/#login$/);
  await expect(page.getByRole("heading", { name: "Yeniden hoş geldin." })).toBeVisible();
  const form = page.getByRole("form", { name: "Hesap giriş formu" });
  await form.getByLabel("E-posta adresi").fill("atlas@example.com");
  await form.getByLabel("Şifre", { exact: true }).fill("my-password");
  await form.getByRole("button", { name: "Şifreyi göster" }).click();
  await expect(form.getByLabel("Şifre", { exact: true })).toHaveAttribute("type", "text");
  await form.getByRole("button", { name: "Hesap oluştur", exact: true }).click();
  await expect(page.getByRole("heading", { name: "İlk adımı birlikte atalım." })).toBeVisible();
  await form.getByRole("button", { name: "Girişe dön", exact: true }).click();
  await form.getByRole("button", { name: "Şifremi unuttum" }).click();
  await expect(page.getByRole("heading", { name: "Şifreni yenileyelim." })).toBeVisible();
  await expect(form.getByLabel("Şifre", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Yeniden hoş geldin." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/login-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Misafir olarak devam et" }).click();
  await expect(page).toHaveURL(/#home$/);
  await expect(
    page.getByRole("heading", { name: "Bugün nereden başlamak istersin?" }),
  ).toBeVisible();
});
