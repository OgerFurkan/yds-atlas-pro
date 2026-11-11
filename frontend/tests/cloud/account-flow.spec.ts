import { expect, type Page, test } from "@playwright/test";
import type { GameSession } from "@yds-atlas/shared";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
function token(userId: string) {
  return [
    btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    btoa(
      JSON.stringify({
        sub: userId,
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ),
    "contract-signature",
  ].join(".");
}
function authSession(userId: string, email: string) {
  return {
    access_token: token(userId),
    refresh_token: "contract-refresh-" + userId,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
    },
  };
}
function word(id: string, name: string) {
  return {
    id,
    word: name,
    meanings: ["Özel anlam"],
    alternatives: [],
    usageNote: "",
    partOfSpeech: "Noun",
    cefr: "B2",
    score: 0,
    examples: [],
    pronunciationUk: "",
    pronunciationUs: "",
    sourceUrl: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
async function mockCloud(page: Page, waitForSessionSave?: Promise<void>) {
  const libraries: Record<string, ReturnType<typeof word>[]> = {
    [alice]: [word("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Evidence")],
    [bob]: [word("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Benefit")],
  };
  const requests: { path: string; method: string; body: unknown }[] = [];
  const accounts: Record<
    string,
    {
      dailyGoal: number;
      session: { snapshot: GameSession; revision: number } | null;
      progress: unknown[];
      completedDays: unknown[];
    }
  > = {
    [alice]: { dailyGoal: 20, session: null, progress: [], completedDays: [] },
    [bob]: { dailyGoal: 20, session: null, progress: [], completedDays: [] },
  };
  await page.route("http://127.0.0.1:54321/auth/v1/**", async (route) => {
    const request = route.request();
    if (request.url().includes("/token")) {
      const credentials = request.postDataJSON();
      const id = credentials.email.startsWith("bob") ? bob : alice;
      await route.fulfill({ json: authSession(id, credentials.email) });
    } else if (request.url().includes("/logout")) await route.fulfill({ status: 204 });
    else if (request.method() === "GET")
      await route.fulfill({ json: authSession(alice, "alice@example.com").user });
    else
      await route.fulfill({
        json: { user: authSession(alice, "alice@example.com").user, session: null },
      });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const headers = request.headers();
    const encoded = (headers.authorization ?? "").split(" ")[1]?.split(".")[1];
    const id = encoded ? JSON.parse(atob(encoded)).sub : alice;
    expect(headers.authorization).toMatch(/^Bearer /);
    expect(headers["x-user-id"]).toBeUndefined();
    const body = request.postData() ? request.postDataJSON() : null;
    requests.push({ path, method: request.method(), body });
    if (path === "/api/account") {
      await route.fulfill({ json: accounts[id] });
      return;
    }
    if (path === "/api/account/goal") {
      accounts[id].dailyGoal = body.goal;
      await route.fulfill({ json: { goal: body.goal } });
      return;
    }
    if (path === "/api/ai/words/enrich") {
      const suggestion = {
        word: "Resilient",
        alternatives: [],
        meanings: ["Dayanıklı"],
        usageNote: "Zorluklar karşısında yeniden toparlanabilen.",
        partOfSpeech: "Adjective",
        cefr: "C1",
        examples: Array.from({ length: 5 }, (_, index) => ({
          sentence: "A resilient team can recover from setback " + index + ".",
          translation: "Dayanıklı bir ekip " + index + ". zorluğun ardından toparlanabilir.",
          translationFocus: ["Dayanıklı"],
        })),
      };
      await route.fulfill({ json: { suggestion, provider: "Gemini", model: "contract-test" } });
      return;
    }
    if (path === "/api/ai/words/complete" || path === "/api/ai/words/suggest") {
      const names = path.endsWith("/complete")
        ? body.words
        : ["Resilient", "Robust", "Notion", "Derive", "Assess"];
      const suggestions = names.map((name: string) => ({
        word: name,
        alternatives: [],
        meanings: ["Dayanıklı"],
        usageNote: "Örnek kullanım.",
        partOfSpeech: "Adjective",
        cefr: "C1",
        examples: Array.from({ length: 5 }, (_, index) => ({
          sentence: `The ${name} example is number ${index}.`,
          translation: `${index}. örnek dayanıklı.`,
          translationFocus: ["dayanıklı"],
        })),
      }));
      await route.fulfill({ json: { suggestions, provider: "Gemini", model: "contract-test" } });
      return;
    }
    if (path === "/api/learning/session") {
      const previous = accounts[id].session;
      expect(body.revision).toBe(previous?.revision ?? 0);
      if (waitForSessionSave) await waitForSessionSave;
      accounts[id].session = { snapshot: body.snapshot, revision: (previous?.revision ?? 0) + 1 };
      await route.fulfill({ json: { revision: accounts[id].session!.revision } });
      return;
    }
    if (path.endsWith("/complete")) {
      const task = accounts[id].session!;
      task.snapshot.saved = true;
      libraries[id][0].score = 88;
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      accounts[id].progress = [{ day, word_id: libraries[id][0].id }];
      await route.fulfill({ json: { scores: [{ id: libraries[id][0].id, score: 88 }] } });
      return;
    }
    if (path === "/api/words" && request.method() === "GET") {
      await route.fulfill({ json: libraries[id] });
      return;
    }
    if (path === "/api/words" && request.method() === "POST") {
      const entry = { ...word(crypto.randomUUID(), body.word), ...body };
      libraries[id].push(entry);
      await route.fulfill({ json: entry });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Unmocked endpoint", code: "NOT_FOUND" } });
  });
  return { libraries, requests, accounts };
}

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
    const left = page.locator(`[data-matching-side="left"][data-word-id="${first.id}"]`);
    const right = page.locator(`[data-matching-side="right"][data-word-id="${first.id}"]`);
    await left.click();
    await expect(left).toHaveAttribute("aria-pressed", "true");
    await left.click();
    await expect(left).toHaveAttribute("aria-pressed", "true");
    await right.click();
    await expect(left).toBeDisabled();
    await expect(page.getByText("1 / 2 eşleşti")).toBeVisible();
    await page.locator(`[data-matching-side="left"][data-word-id="${second.id}"]`).click();
    await page.locator(`[data-matching-side="right"][data-word-id="${second.id}"]`).click();
    await page.locator("#matching-next").click();
    await expect(page.locator("#choice-correct")).toBeVisible();
    await page.locator("#choice-correct").click();
    await expect(page.locator("#question-next")).toBeEnabled();
    await page.locator("#question-next").click();
    await expect(page.locator("#choice-correct")).toBeEnabled();
  } finally {
    releaseSave();
  }
  await expect.poll(() => cloud.accounts[alice].session?.revision).toBe(8);
});
async function login(page: Page, email = "alice@example.com") {
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page).toHaveURL(/#login$/);
  const form = page.getByRole("form", { name: "Hesap giriş formu" });
  await form.getByLabel("E-posta adresi").fill(email);
  await form.getByLabel("Şifre", { exact: true }).fill("test-password");
  await form.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hesabım", exact: true })).toBeVisible();
}
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
  await expect(dialog.getByText(/GEMINI ÖNERİSİ/)).toBeVisible();
  await page.screenshot({
    path: `test-results-cloud/ai-preview-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(cloud.libraries[alice]).toHaveLength(1);
  await dialog.getByRole("button", { name: "İnceledim, öneriyi forma aktar" }).click();
  expect(cloud.libraries[alice]).toHaveLength(1);
  await dialog.getByRole("button", { name: "Kütüphaneye ekle", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Resilient kelime ayrıntıları" })).toBeVisible();
  expect(cloud.libraries[alice]).toHaveLength(2);
  const saved = cloud.requests.find(
    (request) => request.path === "/api/words" && request.method === "POST",
  )!.body as { examples: { translationFocus: string[]; source: string }[]; score: number };
  expect(saved.examples[0].translationFocus).toEqual(["Dayanıklı"]);
  expect(saved.examples[0].source).toContain("Gemini");
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
  expect(cloud.requests.some((request) => request.path === "/api/ai/words/complete")).toBe(true);
  const saved = cloud.requests.find(
    (request) => request.path === "/api/words" && request.method === "POST",
  )!.body as { examples: { source: string }[] };
  expect(saved.examples).toHaveLength(5);
  expect(saved.examples[0].source).toContain("Gemini");
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
  expect(cloud.requests.some((request) => request.path === "/api/ai/words/suggest")).toBe(true);
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
