import { expect, test } from "@playwright/test";

test("login page opens from the header, supports auth modes and returns to guest use", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page).toHaveURL(/#login$/);
  await expect(page.getByRole("heading", { name: "Tekrar hoş geldin." })).toBeVisible();
  const form = page.getByRole("form", { name: "Hesap giriş formu" });
  const remember = form.getByRole("checkbox", { name: "Beni hatırla" });
  await expect(remember).not.toBeChecked();
  await remember.check();
  await expect(remember).toBeChecked();
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
  await expect(page.getByRole("heading", { name: "Tekrar hoş geldin." })).toBeVisible();
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

test("sign-up slides the Atlas panel to the right and sign-in slides it back", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Panel slide is a desktop interaction.");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#login");
  const shell = page.locator(".auth-layout");
  const brand = page.locator(".auth-brand");
  const form = page.locator(".auth-form-panel");
  await expect(shell).toHaveAttribute("data-auth-mode", "signin");
  const shellBox = await shell.boundingBox();
  expect(shellBox).not.toBeNull();
  expect(await brand.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
    "0.7s",
  );
  await form.getByRole("button", { name: "Hesap oluştur", exact: true }).click();
  expect(await brand.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0);
  const midpoint = await brand.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 350;
    return element.getBoundingClientRect().x;
  });
  expect(midpoint).toBeGreaterThan(shellBox!.x + shellBox!.width * 0.1);
  expect(midpoint).toBeLessThan(shellBox!.x + shellBox!.width * 0.4);
  await brand.evaluate((element) => element.getAnimations()[0]?.play());
  await expect(shell).toHaveAttribute("data-auth-mode", "signup");
  await expect
    .poll(async () => {
      const brandBox = await brand.boundingBox();
      const formBox = await form.boundingBox();
      return (
        !!brandBox &&
        !!formBox &&
        Math.abs(brandBox.x - (shellBox!.x + shellBox!.width / 2)) < 2 &&
        Math.abs(formBox.x - shellBox!.x) < 2
      );
    })
    .toBe(true);
  await page.screenshot({
    path: `test-results/signup-slide-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await expect(brand.getByText("Kelime kütüphaneni hesabında sakla")).toBeVisible();
  await brand.getByRole("button", { name: "Girişe dön", exact: true }).click();
  await expect(shell).toHaveAttribute("data-auth-mode", "signin");
  await expect
    .poll(async () => {
      const brandBox = await brand.boundingBox();
      const formBox = await form.boundingBox();
      return (
        !!brandBox &&
        !!formBox &&
        Math.abs(brandBox.x - shellBox!.x) < 2 &&
        Math.abs(formBox.x - (shellBox!.x + shellBox!.width / 2)) < 2
      );
    })
    .toBe(true);
});
