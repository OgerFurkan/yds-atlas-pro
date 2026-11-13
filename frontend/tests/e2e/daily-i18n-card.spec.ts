import { expect, test } from "@playwright/test";

function sampleWord() {
  return {
    id: "translated-day-word",
    word: "garden",
    meanings: ["bahçe"],
    alternatives: [],
    usageNote: "YDS sınavında çevre konularında kullanılabilir.",
    partOfSpeech: "Noun",
    cefr: "A1",
    score: 10,
    examples: Array.from({ length: 5 }, (_, index) => ({
      sentence: `The garden is beautiful in spring ${index}.`,
      translation: `Bahçe ilkbaharda güzeldir ${index}.`,
    })),
    pronunciationUk: "",
    pronunciationUs: "",
    sourceUrl: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("Daily Plan controls and day dialog follow the selected English interface language", async ({ page }) => {
  await page.addInitScript((word) => {
    localStorage.setItem("yds-atlas-language", "en");
    localStorage.setItem("yds-atlas-words-v1", JSON.stringify([word]));
  }, sampleWord());

  await page.goto("/#library");
  await page.getByRole("tab", { name: "Daily Plan" }).click();
  await expect(page.getByRole("heading", { name: "Your daily groups" })).toBeVisible();
  await expect(page.getByText("Manage your own learning path")).toBeVisible();
  await page.getByRole("button", { name: "Open day 1, manage 1 word" }).click();

  const dialog = page.getByRole("dialog", { name: "Day 1 words" });
  await expect(dialog.getByRole("button", { name: "Select from library" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Enter new words in bulk" })).toBeVisible();
  await expect(dialog.getByText("bahçe", { exact: true })).toBeVisible(); // Saved word data is not translated by i18n.
  await dialog.getByRole("button", { name: "Select from library" }).click();
  await expect(dialog.getByRole("region", { name: "Select words in bulk from library" })).toBeVisible();
});

test("White flashcard back keeps readable dark text and light badges in dark theme", async ({ page }) => {
  await page.addInitScript((word) => {
    localStorage.setItem("yds-atlas-language", "tr");
    localStorage.setItem("yds-atlas-theme", "dark");
    localStorage.setItem("yds-atlas-words-v1", JSON.stringify([word]));
  }, sampleWord());

  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await expect(page.locator(".atlas-card-back")).toHaveCount(1);
  const badge = page.locator('.atlas-card-back [data-slot="badge"]').first();
  await expect(badge).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(badge).toHaveCSS("color", "rgb(18, 59, 89)");
  const note = page.locator(".atlas-card-back").getByText("YDS sınavında çevre konularında kullanılabilir.");
  await expect(note).toHaveCSS("color", "rgb(51, 65, 85)");
});

test("Daily target choice stays readable in dark mode and Atlas appears in the plan hero", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yds-atlas-language", "tr");
    localStorage.setItem("yds-atlas-theme", "dark");
  });

  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();

  const hero = page.getByTestId("daily-plan-hero");
  const target = hero.getByRole("group", { name: "Günlük kelime hedefi" });
  const active = target.getByRole("button", { name: "20", exact: true });
  await expect(active).toHaveAttribute("aria-pressed", "true");
  await expect(active).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(active).toHaveCSS("color", "rgb(18, 59, 89)");
  const mascot = hero.locator('img[src="/brand/atlas-mascot.png"]:visible');
  await expect(mascot).toHaveCount(1);
  await expect.poll(() => mascot.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  // Both the selected state and label should update without dark-theme contrast loss.
  const other = target.getByRole("button", { name: "30", exact: true });
  await other.click();
  await expect(other).toHaveAttribute("aria-pressed", "true");
  await expect(other).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(other).toHaveCSS("color", "rgb(18, 59, 89)");
  await expect(active).toHaveAttribute("aria-pressed", "false");
});
