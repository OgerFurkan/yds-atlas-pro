import { expect, test } from "../../../frontend/config/playwright/test-fixtures";

test("mobile Atlas bubble can be hidden and restored without losing the conversation draft", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile");
  await page.goto("/");
  const launcher = page.getByRole("button", { name: "Atlas'a sor", exact: true });
  await expect(launcher).toBeVisible();
  const rect = await launcher.boundingBox(),
    viewport = page.viewportSize()!;
  expect(rect!.width).toBeLessThanOrEqual(56);
  expect(rect!.width).toBeGreaterThanOrEqual(44);
  expect(viewport.width - rect!.x - rect!.width).toBeLessThanOrEqual(24);
  expect(rect!.y).toBeGreaterThan(viewport.height / 2);
  expect(
    await launcher.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return Array.from(document.querySelectorAll("main button, main a[href]")).every((action) => {
        const r = action.getBoundingClientRect();
        return r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom;
      });
    }),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("atlas-mobile-chat.png"), animations: "disabled" });
  await launcher.tap();
  const chat = page.getByRole("dialog", { name: /Atlas/i });
  await chat.getByRole("textbox").fill("Sentetik taslak");
  await chat.getByRole("button", { name: /YDS Atlas/ }).tap();
  await chat.getByRole("button", { name: "Sohbet balonunu gizle" }).tap();
  await expect(chat).toBeHidden();
  await expect(launcher).toBeHidden();
  const restore = async () => {
    await page.getByRole("button", { name: "Menüyü aç" }).tap();
    await page.getByRole("button", { name: "Ayarlar" }).tap();
    const toggle = page.getByRole("checkbox", { name: "Mobilde Atlas sohbet balonunu göster" });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.keyboard.press("Escape");
  };
  await restore();
  await launcher.tap();
  await expect(chat.getByRole("textbox")).toHaveValue("Sentetik taslak");
  await chat.getByRole("button", { name: /YDS Atlas/ }).tap();
  await chat.getByRole("button", { name: "Sohbet balonunu gizle" }).tap();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(launcher).toBeHidden();
  await page.reload();
  await expect(launcher).toBeHidden();
  await page.setViewportSize(viewport);
  await restore();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(launcher).toBeVisible();
  expect((await launcher.boundingBox())!.width).toBeLessThanOrEqual(56);
  await launcher.tap();
  await chat.getByRole("button", { name: /YDS Atlas/ }).tap();
  await expect(chat.getByRole("button", { name: "Sohbet balonunu gizle" })).toBeVisible();
});
