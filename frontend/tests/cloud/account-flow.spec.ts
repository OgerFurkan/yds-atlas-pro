import { expect, type Page, test } from "@playwright/test";
import type { GameSession } from "@yds-atlas/shared";

import { alice, login, mockCloud } from "../helpers/mock-cloud-account";

test("a signed-in game waits for its first save and retries the same task after failure", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  const entry = cloud.libraries[alice][0];
  Object.assign(entry, {
    examples: Array.from({ length: 5 }, (_, i) => ({
      sentence: "The evidence supports claim " + i + ".",
      translation: "Kanıt iddiayı destekler.",
    })),
  });
  const ids: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/learning/session", async (route) => {
    ids.push(route.request().postDataJSON().snapshot.id);
    if (ids.length > 1) return route.fallback();
    await pending;
    return route.fulfill({ status: 503, json: { error: "Test kaydı geçici olarak reddedildi." } });
  });
  await page.goto("/#game");
  await login(page);
  await page.getByRole("button", { name: /kısa görev başlat/ }).click();
  try {
    await expect.poll(() => ids.length).toBe(1);
    await expect(page.getByText("Görev kaydediliyor…")).toBeVisible();
    await expect(page.locator("#atlas-card-flip, #question-choices")).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByRole("alert").filter({ hasText: "Test kaydı" })).toBeVisible();
  await expect(page.locator("#atlas-card-flip")).toHaveCount(0);
  await page.getByRole("button", { name: "Kaydı yeniden dene" }).click();
  await expect(page.locator("#atlas-card-flip")).toBeVisible();
  expect(ids).toEqual([ids[0], ids[0]]);
  expect(cloud.accounts[alice].session?.revision).toBe(1);
});

test("matching responds while a cloud save is pending", async ({ page }) => {
  let releaseSave = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const cloud = await mockCloud(page, gate);
  const first = { ...cloud.libraries[alice][0], word: "Expand", meanings: ["Genişlemek"] };
  const second = {
    ...first,
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    word: "Benefit",
    meanings: ["Fayda"],
  };
  cloud.libraries[alice] = [first, second];
  const snapshot: GameSession = {
    version: 3,
    groupMatching: true,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    words: [first, second] as GameSession["words"],
    batchSize: 5,
    groupIndex: 0,
    phase: "matching",
    queue: [first.id, second.id],
    stageCompleted: 0,
    attempts: {},
    scoreChanges: {},
    assessment: {},
    matching: {
      left: [first.id, second.id],
      right: [second.id, first.id],
      matched: [],
      selectedLeft: null,
      selectedRight: null,
      feedback: null,
    },
    answer: null,
    finalCorrect: 0,
    finalTotal: 0,
    tutorial: false,
    saved: false,
  };
  cloud.accounts[alice].session = { snapshot, revision: 1 };
  try {
    await page.goto("/#game");
    await login(page);
    await page.getByRole("button", { name: "Kaldığım yerden devam et" }).click();
    const left = page.locator('[data-matching-side="left"]').filter({ hasText: first.word });
    const right = page
      .locator('[data-matching-side="right"]')
      .filter({ hasText: first.meanings[0] });
    await left.click();
    await expect(left).toHaveAttribute("aria-pressed", "true");
    await left.click();
    await expect(left).toHaveAttribute("aria-pressed", "true");
    await right.click();
    await expect(left).toBeDisabled();
    await expect(page.getByText("1 / 2 eşleşti")).toBeVisible();
    await page.getByText(second.word, { exact: true }).click();
    await page
      .locator('[data-matching-side="right"]')
      .filter({ hasText: second.meanings[0] })
      .click();
    await page.locator("#matching-next").click();
    await expect(page.locator("#choice-correct, #choice-wrong, [data-word-id]")).toHaveCount(0);
    await page.locator("#question-choices").getByText(first.meanings[0], { exact: true }).click();
    await expect(page.locator("#question-next")).toBeEnabled();
    await page.locator("#question-next").click();
    await expect(page.locator("#question-choices button").first()).toBeEnabled();
  } finally {
    releaseSave();
  }
  await expect.poll(() => cloud.accounts[alice].session?.revision).toBe(8);
});
test("chat menu cancels pending requests and restores the previous conversation", async ({
  page,
}) => {
  await mockCloud(page);
  let releaseResponse = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/ai/chat", async (route) => {
    await gate;
    await route
      .fulfill({ json: { reply: "Late reply", provider: "Gemini", model: "test" } })
      .catch(() => {});
  });
  try {
    await page.goto("/");
    await login(page);
    await page.getByRole("button", { name: "Atlas'a sor" }).click();
    const chat = page.getByRole("dialog", { name: "YDS Atlas Pro Asistanı" });
    await chat.getByRole("button", { name: "Indicate ne demek?" }).click();
    await expect(chat.getByRole("status")).toBeVisible();
    await chat.getByRole("button", { name: /YDS Atlas AI/ }).click();
    await chat.getByRole("button", { name: "Yeni sohbet" }).click();
    await expect(
      chat.getByRole("heading", { name: "Merhaba Ben Atlas, sana nasıl yardımcı olabilirim?" }),
    ).toBeVisible();
    releaseResponse();
    await expect(chat.getByText("Late reply")).toHaveCount(0);
    await chat.getByRole("button", { name: /YDS Atlas AI/ }).click();
    await chat.getByRole("button", { name: "Sohbet geçmişi" }).click();
    await chat.getByRole("button", { name: "Indicate ne demek?", exact: true }).click();
    await expect(chat.getByText("Indicate ne demek?", { exact: true })).toBeVisible();
  } finally {
    releaseResponse();
  }
});
test("remember me selects the intended Supabase session storage", async ({ page }) => {
  await mockCloud(page);
  await page.goto("/");
  await login(page);
  const temporary = await page.evaluate(() => ({
    local: Object.keys(localStorage).some(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
    ),
    tab: Object.keys(sessionStorage).some(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
    ),
  }));
  expect(temporary).toEqual({ local: false, tab: true });
  await page.getByRole("button", { name: "Hesabım", exact: true }).click();
  await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  const form = page.getByRole("form", { name: "Hesap giriş formu" });
  await form.getByLabel("E-posta adresi").fill("alice@example.com");
  await form.getByLabel("Şifre", { exact: true }).fill("test-password");
  await form.getByRole("checkbox", { name: "Beni hatırla" }).check();
  await form.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hesabım", exact: true })).toBeVisible();
  const remembered = await page.evaluate(() => ({
    local: Object.keys(localStorage).some(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
    ),
    tab: Object.keys(sessionStorage).some(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
    ),
  }));
  expect(remembered).toEqual({ local: true, tab: false });
});
test("account login, reload and logout preserve guest data and isolate a second account", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockCloud(page);
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "yds-atlas-words-v1",
      JSON.stringify([
        {
          id: "guest",
          word: "Guest",
          meanings: [],
          alternatives: [],
          usageNote: "",
          partOfSpeech: "",
          cefr: "Belirtilmedi",
          score: 0,
          examples: [],
          pronunciationUk: "",
          pronunciationUs: "",
          sourceUrl: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    ),
  );
  await login(page);
  await page.goto("/#library");
  await expect(page.getByRole("button", { name: "Evidence kelime ayrıntıları" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Guest kelime ayrıntıları" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Evidence kelime ayrıntıları" })).toBeVisible();
  await page.getByRole("button", { name: "Hesabım", exact: true }).click();
  await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();
  await expect(page.getByRole("button", { name: "Guest kelime ayrıntıları" })).toBeVisible();
  await login(page, "bob@example.com");
  await expect(page.getByRole("button", { name: "Benefit kelime ayrıntıları" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Evidence kelime ayrıntıları" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("Gemini suggestion is previewed before application and explicit cloud save", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto("/");
  await login(page);
  await page.getByRole("button", { name: "Kelime ekle", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /İngilizce kelime/ }).fill("Resilient");
  await dialog.getByRole("button", { name: "Öneri oluştur", exact: true }).click();
  await expect(dialog.getByText(/HAVUZ VE AI ÖNERİLERİ/)).toBeVisible();
  await page.screenshot({
    path: `test-results-cloud/ai-preview-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(cloud.libraries[alice]).toHaveLength(1);
  await dialog.getByRole("button", { name: "1 türü inceleyip forma aktar" }).click();
  expect(cloud.libraries[alice]).toHaveLength(1);
  await dialog.getByRole("button", { name: "Kütüphaneye ekle", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Resilient kelime ayrıntıları" })).toBeVisible();
  expect(cloud.libraries[alice]).toHaveLength(2);
  const saved = cloud.requests.find(
    (request) => request.path === "/api/words" && request.method === "POST",
  )!.body as { examples: { translationFocus: string[]; source: string }[]; score: number };
  expect(saved.examples[0].translationFocus).toEqual(["Dayanıklı"]);
  expect(saved.examples[0].source).toContain("Atlas Lexicon · r1");
  expect(saved.examples.map((example) => example.difficulty)).toEqual(["easy", "easy", "medium", "yds", "yds"]);
  expect(saved.score).toBe(0);
});

test("new account words are completed automatically before saving", async ({ page }) => {
  const cloud = await mockCloud(page);
  await page.goto("/");
  await login(page);
  await page.getByRole("button", { name: "Kelime ekle", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /İngilizce kelime/ }).fill("Resilient");
  const saveButton = dialog.getByRole("button", { name: "Kütüphaneye ekle", exact: true });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(dialog).not.toBeVisible();
  expect(cloud.requests.some((request) => request.path === "/api/lexicon/complete")).toBe(true);
  expect(cloud.requests.some((request) => request.path === "/api/ai/words/complete")).toBe(false);
  const saved = cloud.requests.find(
    (request) => request.path === "/api/words" && request.method === "POST",
  )!.body as { examples: { source: string }[] };
  expect(saved.examples).toHaveLength(5);
  expect(saved.examples.map((example) => example.difficulty)).toEqual(["easy", "easy", "medium", "yds", "yds"]);
  expect(saved.examples[0].source).toContain("Atlas Lexicon · r1");
});

test("AI task list is previewed without saving", async ({ page }) => {
  const cloud = await mockCloud(page);
  await page.goto("/#game");
  await login(page);
  await page.getByRole("tab", { name: "AI listesi" }).click();
  await page.getByRole("button", { name: "5 kelime oluştur" }).click();
  await expect(page.getByText("Resilient · Dayanıklı")).toBeVisible();
  await page.getByText("Resilient · Dayanıklı").click();
  await expect(page.getByText("The Resilient example is number 0.")).toBeVisible();
  expect(cloud.libraries[alice]).toHaveLength(1);
  expect(cloud.requests.some((request) => request.path === "/api/lexicon/suggest")).toBe(true);
  expect(cloud.requests.some((request) => request.path === "/api/words" && request.method === "POST")).toBe(false);
});

test("cloud assessment resumes, persists before completion, and restores measured scores", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  const entry = {
    ...cloud.libraries[alice][0],
    word: "Expand",
    meanings: ["Genişlemek"],
    partOfSpeech: "Verb",
    examples: Array.from({ length: 5 }, (_, index) => ({
      sentence: "We expand the project in year " + index + ".",
      translation: "Projeyi " + index + ". yılda genişletiriz.",
      translationFocus: ["genişletiriz"],
    })),
  };
  cloud.libraries[alice] = [entry];
  const snapshot: GameSession = {
    version: 3,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    words: [entry as GameSession["words"][number]],
    batchSize: 5,
    groupIndex: 0,
    phase: "final-context",
    queue: [entry.id],
    stageCompleted: 0,
    attempts: {},
    scoreChanges: {},
    assessment: {
      [entry.id]: {
        matchingDone: true,
        matchingErrors: 0,
        meaning: { correct: true, confidence: 0 },
        context: null,
      },
    },
    matching: null,
    answer: { choice: "Expand", correct: true, confidence: 0 },
    finalCorrect: 2,
    finalTotal: 2,
    tutorial: false,
    saved: false,
  };
  cloud.accounts[alice].session = { snapshot, revision: 1 };
  await page.goto("/#game");
  await login(page);
  await page.getByRole("button", { name: "Kaldığım yerden devam et" }).click();
  await page.locator("#question-next").click();
  await expect(
    page.getByText("Kelime grupların ve günlük ilerlemen güncellendi.", { exact: true }),
  ).toBeVisible();
  const ordered = cloud.requests
    .filter((request) => request.path.startsWith("/api/learning/"))
    .map((request) => request.path);
  expect(ordered).toEqual([
    "/api/learning/session",
    "/api/learning/sessions/" + snapshot.id + "/complete",
  ]);
  expect(cloud.libraries[alice][0].score).toBe(88);
  await page.reload();
  await page.goto("/#library");
  await expect(page.getByRole("button", { name: "Expand kelime ayrıntıları" })).toBeVisible();
  const completed = cloud.requests.filter((request) => request.path.endsWith("/complete"));
  expect(completed).toHaveLength(1);
});
// Phase 3B v1.2: signed-in browser contract tests. All Supabase/API calls
// below are Playwright mocks. No live project or real user data is accessed.
async function captureScopedDailyPlan(page: Page, userId: string) {
  return page.evaluate((id) => {
    const names = [
      "yds-atlas-daily-word-groups-v1",
      "yds-atlas-daily-word-exclusions-v1",
      "yds-atlas-daily-plan-size-v1",
      "yds-atlas-daily-plan-initialized-v1",
    ];
    return names.map((name) => localStorage.getItem(`${name}:${id}`));
  }, userId);
}

async function openAuthenticatedSyncPreview(page: Page) {
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  await page.getByRole("button", { name: "Senkronizasyon önizlemesi" }).click();
  const dialog = page.getByRole("dialog", { name: "Bulut planı karşılaştırması" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Phase 3B: authenticated comparison sends one GET and never saves either plan", async ({ page }) => {
  const mock = await mockCloud(page);
  const wordId = mock.libraries[alice][0].id;
  const methods: string[] = [];
  await page.route("**/api/account/daily-plan", async (route) => {
    const request = route.request();
    methods.push(request.method());
    expect(request.method()).toBe("GET");
    expect(request.headers().authorization).toMatch(/^Bearer /);
    await route.fulfill({ json: {
      revision: 4,
      snapshot: { groupSize: 10, assignments: [{ day: 2, words: [wordId] }], excludedWordIds: [] },
    } });
  });
  await page.goto("/");
  await login(page);
  await page.evaluate(({ id, word }) => {
    localStorage.setItem(`yds-atlas-daily-word-groups-v1:${id}`,
      JSON.stringify([{ day: 1, words: [word] }]));
    localStorage.setItem(`yds-atlas-daily-word-exclusions-v1:${id}`, "[]");
    localStorage.setItem(`yds-atlas-daily-plan-size-v1:${id}`, "20");
    localStorage.setItem(`yds-atlas-daily-plan-initialized-v1:${id}`, "true");
  }, { id: alice, word: wordId });

  const dialog = await openAuthenticatedSyncPreview(page);
  const localBefore = await captureScopedDailyPlan(page, alice);
  expect(methods).toEqual([]); // Opening the modal must not start an API call.
  await dialog.getByRole("button", { name: "Planları karşılaştır" }).click();
  await expect(dialog.getByRole("heading", { name: "Planlar arasında farklar var" })).toBeVisible();
  await expect(dialog.getByText("Farklı günlere atanan kelimeler (1)")).toBeVisible();
  await expect(dialog.getByText("Bulut revizyonu")).toBeVisible();
  await dialog.getByRole("radio", { name: "Buluttaki planı korumak isterim" }).check();
  await expect(dialog.getByText("Bu seçim yalnızca bu penceredeki taslaktır.", { exact: false })).toBeVisible();
  expect(methods).toEqual(["GET"]);
  expect(await captureScopedDailyPlan(page, alice)).toEqual(localBefore);

  await dialog.getByRole("button", { name: "Kapat" }).click();
  await page.getByRole("button", { name: "Senkronizasyon önizlemesi" }).click();
  const reopened = page.getByRole("dialog", { name: "Bulut planı karşılaştırması" });
  await expect(reopened.getByRole("button", { name: "Planları karşılaştır" })).toBeVisible();
  await expect(reopened.getByRole("radio", { name: "Buluttaki planı korumak isterim" })).toHaveCount(0);
  expect(methods).toEqual(["GET"]);
});

test("Phase 3B: revision conflict is shown as an error and retry remains GET-only", async ({ page }) => {
  await mockCloud(page);
  const methods: string[] = [];
  await page.route("**/api/account/daily-plan", async (route) => {
    methods.push(route.request().method());
    await route.fulfill({ status: 409, json: {
      code: "DAILY_PLAN_CONFLICT",
      error: "Günlük plan başka bir cihazda güncellendi.",
    } });
  });
  await page.goto("/");
  await login(page);
  const dialog = await openAuthenticatedSyncPreview(page);
  expect(methods).toHaveLength(0);
  const before = await captureScopedDailyPlan(page, alice);
  await dialog.getByRole("button", { name: "Planları karşılaştır" }).click();
  await expect(dialog.getByRole("alert").getByText("Günlük plan başka bir cihazda güncellendi.")).toBeVisible();
  await dialog.getByRole("button", { name: "Yeniden karşılaştır" }).click();
  await expect.poll(() => methods.length).toBe(2);
  expect(methods).toEqual(["GET", "GET"]);
  expect(await captureScopedDailyPlan(page, alice)).toEqual(before);
});

test("Phase 3B: unknown cloud word blocks choice without modifying local data", async ({ page }) => {
  await mockCloud(page);
  const foreign = "99999999-9999-4999-8999-999999999999";
  const methods: string[] = [];
  await page.route("**/api/account/daily-plan", async (route) => {
    methods.push(route.request().method());
    await route.fulfill({ json: {
      revision: 1,
      snapshot: { groupSize: 20, assignments: [{ day: 1, words: [foreign] }], excludedWordIds: [] },
    } });
  });
  await page.goto("/");
  await login(page);
  const dialog = await openAuthenticatedSyncPreview(page);
  const before = await captureScopedDailyPlan(page, alice);
  await dialog.getByRole("button", { name: "Planları karşılaştır" }).click();
  await expect(dialog.getByRole("heading", { name: "Karşılaştırma engellendi" })).toBeVisible();
  await expect(dialog.getByText("Bulut planında kütüphanede bulunmayan 1 kelime kimliği var.")).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  expect(methods).toEqual(["GET"]);
  expect(await captureScopedDailyPlan(page, alice)).toEqual(before);
});
