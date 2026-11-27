import { expect, test } from "../../../frontend/config/playwright/test-fixtures";
import { storageKeys as keys } from "../../../frontend/src/shared/lib/storage-keys";
import { readyDayWords } from "../fixtures/day-study-words";

declare global {
  interface Window {
    storageProbe: { writes: string[]; snapshot(): (string | null)[]; recover(): void };
  }
}

for (const fault of ["json", "denied", "schema", "plan"] as const) {
  test(`library retry preserves the original day, exclusions and size after ${fault}`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ keys, fault, words }) => {
        const raw = JSON.stringify(words);
        const plan = JSON.stringify([{ day: 60, words: [words[0].id] }]);
        const entries = [
          [keys.words, fault === "json" ? "{" : fault === "schema" ? "null" : raw],
          [keys.dailyWordGroups, fault === "plan" ? "null" : plan],
          [keys.dailyWordExclusions, JSON.stringify([words[1].id])],
          [keys.dailyPlanGroupSize, "30"],
          [keys.dailyPlanInitialized, "true"],
        ];
        const read = Storage.prototype.getItem;
        const write = Storage.prototype.setItem;
        const remove = Storage.prototype.removeItem;
        for (const [key, value] of entries) write.call(localStorage, key, value);
        const writes: string[] = [];
        let denied = fault === "denied";
        Storage.prototype.getItem = function (key) {
          if (this === localStorage && denied && key === keys.words)
            throw new DOMException("Denied", "SecurityError");
          return read.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (this === localStorage && entries.some(([k]) => k === key)) writes.push(key);
          write.call(this, key, value);
        };
        Storage.prototype.removeItem = function (key) {
          if (this === localStorage && entries.some(([k]) => k === key)) writes.push(key);
          remove.call(this, key);
        };
        window.storageProbe = {
          writes,
          snapshot: () => entries.map(([key]) => read.call(localStorage, key)),
          recover() {
            denied = false;
            write.call(localStorage, keys.words, raw);
            write.call(localStorage, keys.dailyWordGroups, plan);
          },
        };
      },
      { keys, fault, words: readyDayWords.slice(0, 2) },
    );
    await page.goto("/#library");
    const retry = page.getByRole("button", { name: "Yeniden dene" });
    await expect(retry).toBeVisible();
    const before = await page.evaluate(() => window.storageProbe.snapshot());
    await retry.click();
    await expect(retry).toBeVisible();
    expect(await page.evaluate(() => window.storageProbe.snapshot())).toEqual(before);
    expect(await page.evaluate(() => window.storageProbe.writes)).toEqual([]);
    await page.evaluate(() => window.storageProbe.recover());
    await retry.click();
    await page.getByRole("tab", { name: /Günlük Plan/ }).click();
    await expect(page.getByRole("button", { name: "60. günü aç, 1 kelimeyi yönet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "30", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await page.evaluate(() => window.storageProbe.writes)).toEqual([]);
  });
}

test("a superseded library snapshot cannot write a plan setting", async ({ page }) => {
  await page.addInitScript(
    ({ keys, words }) => localStorage.setItem(keys.words, JSON.stringify(words)),
    {
      keys,
      words: readyDayWords.slice(0, 2),
    },
  );
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await expect(page.getByRole("button", { name: "1. günü aç, 2 kelimeyi yönet" })).toBeVisible();
  const groups = await page.evaluate(
    ({ keys, words }) => {
      localStorage.setItem(keys.words, JSON.stringify(words));
      return localStorage.getItem(keys.dailyWordGroups);
    },
    { keys, words: readyDayWords.slice(0, 3) },
  );
  await page.getByRole("button", { name: "40", exact: true }).click();
  await expect(page.getByRole("button", { name: "Yeniden dene" })).toBeVisible();
  expect(
    await page.evaluate(
      (keys) => [
        localStorage.getItem(keys.dailyWordGroups),
        localStorage.getItem(keys.dailyPlanGroupSize),
      ],
      keys,
    ),
  ).toEqual([groups, null]);
});

test("choosing a group size on first use leaves a readable empty library on reload", async ({
  page,
}) => {
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await page.getByRole("button", { name: "40", exact: true }).click();
  // The click queues a Web Lock. Reload only after both records are committed.
  await expect
    .poll(() =>
      page.evaluate(
        ({ dailyPlanGroupSize, words }) => [
          localStorage.getItem(dailyPlanGroupSize),
          localStorage.getItem(words),
        ],
        keys,
      ),
    )
    .toEqual(["40", "[]"]);
  await page.reload();
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await expect(page.getByRole("button", { name: "40", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), keys.words)).toBe("[]");
});

test("a new guest can choose a daily goal before adding the first word", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Hedefi düzenle" }).click();
  await page.getByRole("button", { name: "Hedefi 10 artır" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        ({ dailyGoal, words }) => [localStorage.getItem(dailyGoal), localStorage.getItem(words)],
        keys,
      ),
    )
    .toEqual(["30", null]);
  await page.goto("/#library");
  await expect(page.getByRole("button", { name: "İlk kelimeni ekle" })).toBeVisible();
});

test("an unreadable goal is preserved until the original value can be read", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => localStorage.setItem(key, "broken"), keys.dailyGoal);
  await page.reload();
  await expect(page.getByText(/Günlük hedef okunamadı/)).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), keys.dailyGoal)).toBe("broken");
  await page.evaluate((key) => localStorage.setItem(key, "40"), keys.dailyGoal);
  await page.getByRole("button", { name: "Yeniden dene" }).click();
  await page.getByRole("button", { name: "Hedefi düzenle" }).click();
  await expect(page.getByRole("dialog").locator("output")).toContainText("40");
});

test("goal write quota keeps the confirmed value and reports the failure", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("synthetic quota", "QuotaExceededError");
      write.call(this, name, value);
    };
  }, keys.dailyGoal);
  await page.getByRole("button", { name: "Hedefi düzenle" }).click();
  await page.getByRole("button", { name: "Hedefi 10 artır" }).click();
  await expect(page.getByRole("dialog").locator("output")).toContainText("20");
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await expect(page.getByText(/Tarayıcı kaydı yapılamadı/)).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), keys.dailyGoal)).toBeNull();
});

test("a guest with an old initialization marker can explicitly start a missing library", async ({
  page,
}) => {
  await page.addInitScript(({ dailyPlanInitialized, dailyGoal }) => {
    localStorage.setItem(dailyPlanInitialized, " true ");
    localStorage.setItem(dailyGoal, "30");
  }, keys);
  await page.goto("/#library");
  const retry = page.getByRole("button", { name: "Yeniden dene" });
  await retry.click();
  await expect(retry).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), keys.words)).toBeNull();

  const recover = page.getByRole("button", { name: "Boş kütüphane oluştur" });
  await expect(recover).toBeVisible();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await recover.click();
  expect(await page.evaluate((key) => localStorage.getItem(key), keys.words)).toBeNull();

  page.once("dialog", (dialog) => void dialog.accept());
  await recover.click();
  await expect(page.getByRole("button", { name: "İlk kelimeni ekle" })).toBeVisible();
  expect(
    await page.evaluate(
      ({ words, dailyPlanInitialized, dailyGoal }) =>
        [words, dailyPlanInitialized, dailyGoal].map((key) => localStorage.getItem(key)),
      keys,
    ),
  ).toEqual(["[]", " true ", "30"]);
});
