import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Lightweight local keyboard/viewport checks; not axe, UAT or approved screenshot diff.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const target = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(target.hostname))
      return route.abort("blockedbyclient");
    return route.continue();
  });
});
test("responsive routes, heading and keyboard focus", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/#home");
    await expect(page.getByRole("heading").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1,
    );
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () =>
          document.activeElement !== document.body &&
          document.activeElement !== document.documentElement,
      ),
    ).toBe(true);
  }
});
test("no duplicate DOM ids in unauthenticated home/login", async ({ page }) => {
  for (const path of ["/#home", "/#login"]) {
    await page.goto(path);
    const duplicated = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map((x) => x.id).filter(Boolean);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    });
    expect(duplicated).toEqual([]);
  }
});
test("approved golden baseline", async ({ page }) => {
  test.skip(
    process.env.ATLAS_APPROVED_VISUAL_BASELINES !== "true",
    "No PO-approved baseline yet: VISUAL_NOT_VERIFIED",
  );
  await page.goto("/#home");
  await expect(page).toHaveScreenshot("atlas-home-approved.png", { fullPage: true });
});

test("axe WCAG A/AA audit on guest home and sign-in", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of ["/#home", "/#login"]) {
    await page.goto(route);
    await expect(page.getByRole("heading").first()).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target.join(" ")).slice(0, 25),
      })),
      route,
    ).toEqual([]);
  }
});
