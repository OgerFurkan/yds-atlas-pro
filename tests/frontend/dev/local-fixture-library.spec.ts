import { expect, test } from "../../../frontend/playwright-test";
import { partiallyLearnedDayWords, readyDayWords } from "../fixtures/day-study-words";

test("normal library loads and removes two fixture groups without touching guest data", async ({
  page,
  baseURL,
}) => {
  const unexpected: string[] = [];
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL && !url.pathname.startsWith("/api/")) return route.continue();
    unexpected.push(url.href);
    return route.abort();
  });
  const wordsKey = "yds-atlas-words-v1";
  const groupsKey = "yds-atlas-daily-word-groups-v1";
  const personal = { ...readyDayWords[0], id: "guest-word", score: 92 };
  const existing = { ...readyDayWords[1], id: "test-profile-word", word: "Existing", score: 91 };
  await page.addInitScript(
    ({ wordsKey, groupsKey, personal, existing }) => {
      if (localStorage.getItem(wordsKey)) return;
      localStorage.setItem(wordsKey, JSON.stringify([personal]));
      localStorage.setItem(groupsKey, JSON.stringify([{ day: 3, words: [personal.id] }]));
      localStorage.setItem(`${wordsKey}:local-fixtures`, JSON.stringify([existing]));
      localStorage.setItem(
        `${groupsKey}:local-fixtures`,
        JSON.stringify([{ day: 1, words: [existing.id] }]),
      );
    },
    { wordsKey, groupsKey, personal, existing },
  );
  await page.goto("/#library");
  const load = page.getByRole("button", { name: "Sentetik test verilerini yükle" });
  await load.click();
  await expect(page.getByText("Hazır: 20 / 20")).toBeVisible();
  await expect(page.getByText("Hazır: 0 / 4")).toBeVisible();
  await expect(page.getByRole("button", { name: /2\. günü aç, 20 kelime/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /3\. günü aç, 4 kelime/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "3. günün kelimeleriyle çalış" })).toBeDisabled();
  await load.click();
  await expect(page.getByText("Hazır: 20 / 20")).toHaveCount(1);
  await page.getByRole("button", { name: "2. günün kelimeleriyle çalış" }).click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await expect(page.getByText("Hazır: 20 / 20")).toBeVisible();
  await page.getByRole("button", { name: "Yalnız sentetik verileri kaldır" }).click();
  await expect(page.getByText("Hazır: 20 / 20")).toHaveCount(0);
  await expect(page.getByText("Hazır: 0 / 4")).toHaveCount(0);
  const stored = await page.evaluate(
    ({ wordsKey, groupsKey }) => ({
      personal: JSON.parse(localStorage.getItem(wordsKey)!),
      personalGroups: JSON.parse(localStorage.getItem(groupsKey)!),
      testWords: JSON.parse(localStorage.getItem(`${wordsKey}:local-fixtures`)!),
      testGroups: JSON.parse(localStorage.getItem(`${groupsKey}:local-fixtures`)!),
      session: localStorage.getItem("yds-atlas-learning-session-v2:local-fixtures"),
    }),
    { wordsKey, groupsKey },
  );
  expect(stored).toEqual({
    personal: [personal],
    personalGroups: [{ day: 3, words: [personal.id] }],
    testWords: [existing],
    testGroups: [{ day: 1, words: [existing.id] }],
    session: null,
  });
  expect(unexpected).toEqual([]);
});

test("the 5 learned / 15 remaining variant reviews all 20 and studies only 15", async ({
  page,
  baseURL,
}) => {
  const unexpected: string[] = [];
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL && !url.pathname.startsWith("/api/")) return route.continue();
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto("/#library");
  await page.getByRole("button", { name: "5 öğrenilmiş / 15 kalan yükle" }).click();
  await expect(page.getByText("Hazır: 15 / 15")).toBeVisible();
  await expect(page.getByText("Hazır: 0 / 4")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("yds-atlas-words-v1"))).toBeNull();
  const review = page.getByRole("button", { name: "1. günün kelimelerini puansız tekrar et" });
  await expect(review).toBeEnabled();
  const before = await page.evaluate(() =>
    localStorage.getItem("yds-atlas-words-v1:local-fixtures"),
  );
  await review.click();
  await expect(page.locator("#day-review")).toBeVisible();
  await expect(page.getByText(/1 \/ 2 tur · 10 kelime/)).toBeVisible();
  await page.getByRole("button", { name: "Çık" }).click();
  expect(await page.evaluate(() => localStorage.getItem("yds-atlas-words-v1:local-fixtures"))).toBe(
    before,
  );
  await page.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("yds-atlas-learning-session-v2:local-fixtures");
        return raw
          ? JSON.parse(raw)
              .words.map((word: { id: string }) => word.id)
              .sort()
          : null;
      }),
    )
    .toEqual(
      partiallyLearnedDayWords
        .slice(5)
        .map((word) => word.id)
        .sort(),
    );
  expect(unexpected).toEqual([]);
});
