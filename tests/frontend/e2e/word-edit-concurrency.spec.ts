import { guestOrigin } from "../../../frontend/config/playwright/loopback";
import { expect, test } from "../../../frontend/config/playwright/test-fixtures";
import { readyDayWords } from "../fixtures/day-study-words";

test("a guest browser without Web Locks keeps the draft and leaves the newer record untouched", async ({
  page,
  context,
}) => {
  const word = readyDayWords[0];
  const key = "yds-atlas-words-v1";
  await page.addInitScript(
    ({ word, key }) => {
      Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
      localStorage.setItem(key, JSON.stringify([word]));
    },
    { word, key },
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.locator("#daily-day-1-open").click();
  await page.getByRole("button", { name: `${word.word} kelimesini düzenle` }).click();
  const form = page.getByRole("dialog", { name: "Kelimeyi düzenle" });
  const draft = form.getByRole("textbox", { name: "Kullanım ayrımı" });
  await draft.fill("Kaydedilmemiş misafir taslağı");
  const other = await context.newPage();
  await other.goto("/#library");
  const latest = {
    ...word,
    score: 87,
    usageNote: "Diğer sekmenin notu",
    srs: { interval: 4 },
    updatedAt: new Date().toISOString(),
  };
  await other.evaluate(({ key, latest }) => localStorage.setItem(key, JSON.stringify([latest])), {
    key,
    latest,
  });
  await page.bringToFront();
  await form.getByRole("button", { name: "Değişiklikleri kaydet" }).press("Enter");
  await expect(form.getByRole("alert")).toContainText("Değişiklikler kaydedilmedi");
  await expect(form.getByRole("alert")).toContainText("Taslağın bu formda duruyor");
  await expect(draft).toHaveValue("Kaydedilmemiş misafir taslağı");
  expect(await other.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), key)).toEqual(
    [latest],
  );
});

test("a stale example edit preserves another tab's score and note and keeps its draft", async ({
  page,
  context,
}) => {
  const word = readyDayWords[0];
  const key = "yds-atlas-words-v1";
  await context.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(guestOrigin + "/")
      ? route.continue()
      : route.abort(),
  );
  await context.addInitScript(
    ({ key, word }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([word]));
    },
    { key, word },
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.locator("#daily-day-1-open").click();
  const library = page.getByRole("button", { name: `${word.word} kelimesini düzenle` });
  await library.click();
  const form = page.getByRole("dialog", { name: "Kelimeyi düzenle" });
  await expect(form).toBeVisible();
  const other = await context.newPage();
  await other.goto("/#library");
  // Simulate assessment persistence before editing the note through the real form.
  const srs = { interval: 4, repetitions: 3 };
  await other.evaluate(
    ({ key, word, srs }) =>
      navigator.locks.request(key, () => {
        localStorage.setItem(
          key,
          JSON.stringify([
            {
              ...word,
              score: 87,
              srs,
              updatedAt: new Date().toISOString(),
            },
          ]),
        );
        window.dispatchEvent(new Event("storage"));
      }),
    { key, word, srs },
  );
  await other.getByRole("tab", { name: "Günlük Plan" }).click();
  await other.locator("#daily-day-1-open").click();
  await other.getByRole("button", { name: `${word.word} kelimesini düzenle` }).click();
  const otherForm = other.getByRole("dialog", { name: "Kelimeyi düzenle" });
  await otherForm
    .getByRole("textbox", { name: "Kullanım ayrımı" })
    .fill("İkinci sekmenin yeni notu");
  await otherForm.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(otherForm).toHaveCount(0);
  await page.bringToFront();
  const changeExample = async (translation: string) => {
    await form.getByRole("button", { name: "1. örnek cümleyi düzenle" }).click();
    await form.getByRole("textbox", { name: "Türkçe çeviri" }).fill(translation);
    await form.getByRole("button", { name: "Uygula", exact: true }).click();
    await form.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  };
  const read = () => other.evaluate((key) => JSON.parse(localStorage.getItem(key)!)[0], key);
  await changeExample("Birinci sekmenin yeni çevirisi.");
  await expect
    .poll(async () => {
      const saved = await read();
      if (saved.score === 0) return "stale write replaced score";
      return await form
        .getByRole("alert")
        .filter({ hasText: /başka bir sekmede/ })
        .count();
    })
    .toBe(1);
  await expect(form.getByText("Birinci sekmenin yeni çevirisi.", { exact: true })).toBeVisible();
  expect(await read()).toMatchObject({
    score: 87,
    srs,
    usageNote: "İkinci sekmenin yeni notu",
    examples: word.examples,
  });
  await form.getByRole("button", { name: "Kelime penceresini kapat" }).click();
  await library.click();
  await changeExample("Güncel sürümde kaydedilen çeviri.");
  await expect(form).toHaveCount(0);
  const saved = await read();
  expect(saved).toMatchObject({ score: 87, usageNote: "İkinci sekmenin yeni notu", srs });
  expect(saved.examples[0].translation).toBe("Güncel sürümde kaydedilen çeviri.");
  expect(saved.examples.slice(1)).toEqual(word.examples.slice(1));
});
