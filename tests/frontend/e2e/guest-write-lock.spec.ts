import { expect, type Page, test } from "../../../frontend/config/playwright/test-fixtures";
import { storageKeys } from "../../../frontend/src/shared/lib/storage-keys";
import { createSession } from "../../../packages/shared/src/game-engine";
import { readyDayWords } from "../fixtures/day-study-words";

test("a resumed guest result cannot overwrite the newer score of another tab", async ({
  page,
  context,
}) => {
  const writer = await context.newPage();
  await writer.goto("/");
  const [word] = readyDayWords;
  const session = { ...createSession([word], 5), phase: "complete", queue: [] };
  const latest = { ...word, score: 91, updatedAt: "2026-11-25T02:00:00.000Z" };
  await writer.evaluate(
    ({ keys, word, session }) => {
      localStorage.setItem(keys.words, JSON.stringify([word]));
      localStorage.setItem(keys.gameSession, JSON.stringify(session));
    },
    { keys: storageKeys, word, session },
  );
  await page.goto("/#game");
  const resume = page.getByRole("button", { name: "Kaldığım yerden devam et" });
  await expect(resume).toBeVisible();
  await writer.evaluate(
    ({ key, latest }) =>
      navigator.locks.request(key, () => {
        localStorage.setItem(key, JSON.stringify([latest]));
      }),
    { key: storageKeys.words, latest },
  );
  await resume.click();
  await expect(page.getByText(/Puanlar kaydedilmedi/)).toBeVisible();
  expect(
    await writer.evaluate(
      (k) => [
        localStorage.getItem(k.words),
        localStorage.getItem(k.dailyProgress),
        JSON.parse(localStorage.getItem(k.gameSession)!).saved,
      ],
      storageKeys,
    ),
  ).toEqual([JSON.stringify([latest]), null, false]);
});

test("automatic plan sync waits for the writer and preserves its assignment and exclusion", async ({
  page,
  context,
}) => {
  const writer = await context.newPage();
  await writer.goto("/");
  const [manual, excluded, unassigned] = readyDayWords;
  await writer.evaluate(
    ({ keys, words }) => {
      localStorage.setItem(keys.words, JSON.stringify(words));
      return new Promise<void>((held) => {
        void navigator.locks.request(keys.words, async () => {
          held();
          await new Promise((resolve) =>
            window.addEventListener("finish-plan", resolve, { once: true }),
          );
          localStorage.setItem(
            keys.dailyWordGroups,
            JSON.stringify([{ day: 60, words: [words[0].id] }]),
          );
          localStorage.setItem(keys.dailyWordExclusions, JSON.stringify([words[1].id]));
        });
      });
    },
    { keys: storageKeys, words: [manual, excluded, unassigned] },
  );
  await page.goto("/#library");
  await expect
    .poll(() =>
      writer.evaluate(
        async (key) => (await navigator.locks.query()).pending?.some((lock) => lock.name === key),
        storageKeys.words,
      ),
    )
    .toBe(true);
  expect(
    await writer.evaluate((key) => localStorage.getItem(key), storageKeys.dailyWordGroups),
  ).toBeNull();
  await writer.evaluate(() => window.dispatchEvent(new Event("finish-plan")));
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
        storageKeys.dailyWordGroups,
      ),
    )
    .toEqual([
      { day: 1, words: [unassigned.id] },
      { day: 60, words: [manual.id] },
    ]);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKeys.dailyWordExclusions),
  ).toBe(JSON.stringify([excluded.id]));
});

test("a failed second write reports the group setting failure and leaves a readable empty library", async ({
  page,
}) => {
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("synthetic quota failure", "QuotaExceededError");
      return set.call(this, name, value);
    };
  }, storageKeys.dailyPlanGroupSize);
  await page.getByRole("button", { name: "40", exact: true }).click();
  await expect(page.getByText(/Tarayıcı kaydı yapılamadı/)).toBeVisible();
  expect(
    await page.evaluate(
      (k) => [localStorage.getItem(k.words), localStorage.getItem(k.dailyPlanGroupSize)],
      storageKeys,
    ),
  ).toEqual(["[]", null]);
  await page.reload();
  await expect(page.getByRole("button", { name: "İlk kelimeni ekle" })).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKeys.dailyPlanGroupSize),
  ).toBe("40");
});

async function prepareWord(page: Page, name: string) {
  await page.getByRole("button", { name: "İlk kelimeni ekle" }).click();
  const input = page.getByRole("textbox", { name: /İngilizce kelime/ });
  await input.fill(name);
  await input.press("Tab");
  await expect(input).toHaveValue(name);
}

test("first plan setting waits for a first word already being written in another tab", async ({
  page,
  context,
}) => {
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  const writer = await context.newPage();
  await writer.goto("/");
  await writer.evaluate(
    ({ key, word }) =>
      new Promise<void>((held) => {
        void navigator.locks.request(key, async () => {
          held();
          await new Promise((resolve) =>
            window.addEventListener("finish-first-word", resolve, { once: true }),
          );
          localStorage.setItem(key, JSON.stringify([word]));
        });
      }),
    { key: storageKeys.words, word: readyDayWords[0] },
  );
  await page.getByRole("button", { name: "40", exact: true }).click();
  await expect
    .poll(() =>
      writer.evaluate(
        async (key) => (await navigator.locks.query()).pending?.some((lock) => lock.name === key),
        storageKeys.words,
      ),
    )
    .toBe(true);
  expect(await writer.evaluate((key) => localStorage.getItem(key), storageKeys.words)).toBeNull();
  await writer.evaluate(async (key) => {
    window.dispatchEvent(new Event("finish-first-word"));
    await navigator.locks.request(key, () => {});
  }, storageKeys.words);
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), storageKeys.words),
    )
    .toEqual([readyDayWords[0]]);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKeys.dailyPlanGroupSize),
  ).toBeNull();
});

test("concurrent first additions from two guest forms both survive", async ({ page, context }) => {
  const other = await context.newPage();
  await Promise.all([page.goto("/#library"), other.goto("/#library")]);
  await prepareWord(page, "Abandon");
  await prepareWord(other, "Benefit");
  await page.evaluate(
    (key) =>
      new Promise<void>((held) => {
        void navigator.locks.request(key, async () => {
          held();
          await new Promise((resolve) =>
            window.addEventListener("release-additions", resolve, { once: true }),
          );
        });
      }),
    storageKeys.words,
  );
  await Promise.all(
    [page, other].map((tab) => tab.getByRole("button", { name: "Kütüphaneye ekle" }).click()),
  );
  await expect
    .poll(() =>
      page.evaluate(
        async (key) =>
          (await navigator.locks.query()).pending?.filter((lock) => lock.name === key).length,
        storageKeys.words,
      ),
    )
    .toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event("release-additions")));
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key) ?? "[]")
            .map((w: { word: string }) => w.word)
            .sort(),
        storageKeys.words,
      ),
    )
    .toEqual(["Abandon", "Benefit"]);
});

test("queued deletion preserves a newer score and manual plan from another tab", async ({
  page,
  context,
}) => {
  const writer = await context.newPage();
  await writer.goto("/");
  const [word, excluded] = readyDayWords;
  const groups = JSON.stringify([{ day: 60, words: [word.id] }]);
  await writer.evaluate(
    ({ keys, word, excluded, groups }) => {
      localStorage.setItem(keys.words, JSON.stringify([word, excluded]));
      localStorage.setItem(keys.dailyWordGroups, groups);
      localStorage.setItem(keys.dailyPlanGroupSize, "30");
      localStorage.setItem(keys.dailyWordExclusions, JSON.stringify([excluded.id]));
    },
    { keys: storageKeys, word, excluded, groups },
  );
  await page.goto("/#library");
  const remove = page.getByRole("button", { name: word.word + " kelimesini sil" });
  await expect(remove).toBeVisible();
  const newer = { ...word, score: 89, updatedAt: "2026-11-25T01:00:00.000Z" };
  await writer.evaluate(
    ({ key, words }) =>
      new Promise<void>((held) => {
        void navigator.locks.request(key, async () => {
          held();
          await new Promise((resolve) =>
            window.addEventListener("commit-score", resolve, { once: true }),
          );
          localStorage.setItem(key, JSON.stringify(words));
        });
      }),
    { key: storageKeys.words, words: [newer, excluded] },
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await remove.click();
  await expect
    .poll(() =>
      writer.evaluate(
        async (key) => (await navigator.locks.query()).pending?.some((lock) => lock.name === key),
        storageKeys.words,
      ),
    )
    .toBe(true);
  await writer.evaluate(async (key) => {
    window.dispatchEvent(new Event("commit-score"));
    await navigator.locks.request(key, () => {});
  }, storageKeys.words);
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await expect(page.getByRole("button", { name: "60. günü aç, 1 kelimeyi yönet" })).toBeVisible();
  expect(
    await writer.evaluate(
      (k) =>
        [k.words, k.dailyWordGroups, k.dailyWordExclusions, k.dailyPlanGroupSize].map((key) =>
          localStorage.getItem(key),
        ),
      storageKeys,
    ),
  ).toEqual([JSON.stringify([newer, excluded]), groups, JSON.stringify([excluded.id]), "30"]);
});

test("reload cancels an unacknowledged group setting waiting for another tab", async ({
  page,
  context,
}) => {
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  const writer = await context.newPage();
  await writer.goto("/");
  await writer.evaluate(
    (key) =>
      new Promise<void>((held) => {
        void navigator.locks.request(key, async () => {
          held();
          await new Promise((resolve) =>
            window.addEventListener("release-plan-lock", resolve, { once: true }),
          );
        });
      }),
    storageKeys.words,
  );
  const setting = page.getByRole("button", { name: "40", exact: true });
  await setting.click();
  await expect
    .poll(() =>
      writer.evaluate(
        async (key) => (await navigator.locks.query()).pending?.some((lock) => lock.name === key),
        storageKeys.words,
      ),
    )
    .toBe(true);
  await expect(setting).toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await writer.evaluate(async (key) => {
    window.dispatchEvent(new Event("release-plan-lock"));
    await navigator.locks.request(key, () => {});
  }, storageKeys.words);
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await expect(setting).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKeys.dailyPlanGroupSize),
  ).toBeNull();

  await setting.click();
  await expect(setting).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await expect(setting).toHaveAttribute("aria-pressed", "true");
});
