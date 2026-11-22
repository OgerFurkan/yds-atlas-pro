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
  const requests: { path: string; method: string; body: unknown; expectedUpdatedAt?: string }[] = [];
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
    requests.push({ path, method: request.method(), body,
      expectedUpdatedAt: headers["x-atlas-expected-updated-at"] });
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
    const updateId = new RegExp("^/api/words/([^/]+)$").exec(path)?.[1];
    if (updateId && request.method() === "PUT") {
      const index = libraries[id].findIndex((entry) => entry.id === updateId);
      if (index < 0) {
        await route.fulfill({ status: 404, json: { error: "Word not found" } });
        return;
      }
      if (headers["x-atlas-expected-updated-at"] &&
          headers["x-atlas-expected-updated-at"] !== libraries[id][index].updatedAt) {
        await route.fulfill({ status: 409, json: { error: "Kelime değişti", code: "WORD_VERSION_CONFLICT" } });
        return;
      }
      const updated = {
        ...libraries[id][index], ...body, id: updateId,
        createdAt: libraries[id][index].createdAt,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      };
      libraries[id][index] = updated;
      await route.fulfill({ json: updated });
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
    await chat.getByRole("button", { name: "Indicate ne demek?", exact: true }).click();
    await expect(chat.getByRole("status")).toBeVisible();
    await chat.getByRole("button", { name: /YDS Atlas AI/ }).click();
    await chat.getByRole("button", { name: "Yeni sohbet" }).click();
    await expect(
      chat.getByRole("heading", { name: "Merhaba Ben Atlas, sana nasıl yardımcı olabilirim?", exact: true }),
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
  expect(saved.examples[0].translationFocus.map(focus => focus.toLocaleLowerCase("tr"))).toEqual(["dayanıklı"]);
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

test("six confirmed legacy words auto-upgrade on opening the library, preserving examples and scores", async ({ page }) => {
  const cloud = await mockCloud(page);
  const names = ["Evidence", "Obtain", "Adapt", "Analyze", "Maintain", "Clarify"];
  const initial = names.map((name, index) => ({
    ...word("00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"), name),
    score: 25 + index,
    meanings: ["Kişisel anlam " + index],
    examples: [{
      sentence: "Learners use " + name.toLowerCase() + " in context.",
      translation: "Önceki örnek " + index + ".",
      translationFocus: ["Önceki"],
      source: "Kullanıcı",
    }],
  }));
  cloud.libraries[alice] = initial as unknown as ReturnType<typeof word>[];
  await page.goto("/");
  await login(page);
  await page.goto("/#library");
  // The account owner grants explicit consent once; subsequent tier completion
  // and shared dictionary warmup run without the two legacy operation banners.
  expect(cloud.requests.some(req => req.method === "PUT")).toBe(false);
  const enable = page.getByRole("button", { name: "Otomatik tamamlamayı aç" });
  await expect(enable).toBeVisible();
  page.once("dialog", dialog => void dialog.accept());
  await enable.click();
  await expect.poll(() => cloud.requests.filter(req =>
    req.path.startsWith("/api/words/") && req.method === "PUT").length,
    { timeout: 30_000 }).toBe(6);
  const saves = cloud.requests.filter(req => req.path.startsWith("/api/words/") && req.method === "PUT");
  expect(saves).toHaveLength(6);
  expect(saves.every(req => typeof req.expectedUpdatedAt === "string")).toBe(true);
  const completions = cloud.requests.filter(req => req.path === "/api/ai/words/complete");
  expect(completions).toHaveLength(2);
  expect((completions[0].body as {words:string[]}).words).toHaveLength(5);
  expect((completions[1].body as {words:string[]}).words).toHaveLength(1);
  for (const [index, name] of names.entries()) {
    // The mock library intentionally replaces array entries after PUT; compare
    // with immutable pre-operation fixtures, not aliased in-memory objects.
    const originalId = "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0");
    const actual = cloud.libraries[alice].find(entry => entry.id === originalId);
    expect(actual).toBeDefined();
    expect(actual!.score).toBe(25 + index);
    expect(actual!.meanings).toEqual(["Kişisel anlam " + index]);
    const savedExamples = actual!.examples as Array<{
      sentence: string; source?: string; difficulty?: string;
    }>;
    expect(savedExamples.slice(0,5).map(e => e.difficulty))
      .toEqual(["easy", "easy", "medium", "yds", "yds"]);
    expect(savedExamples[5].sentence).toBe("Learners use " + name.toLowerCase() + " in context.");
    expect(savedExamples[5].source).toBe("Kullanıcı");
  }
});

test("automatic legacy repair stops on a simulated concurrent tab edit", async ({ page }) => {
  const cloud = await mockCloud(page);
  const initial = {
    ...word("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Evidence"),
    meanings: ["Eski anlam"], score: 18,
    examples: [{sentence:"My original evidence matters.",translation:"Kendi çevirim.",source:"Kullanıcı"}],
  };
  cloud.libraries[alice] = [initial];
  await page.route("**/api/words/*", async (route) => {
    if (route.request().method() !== "PUT") { await route.fallback(); return; }
    // A different tab/phone saved new content while AI was preparing a draft.
    cloud.libraries[alice][0] = {
      ...cloud.libraries[alice][0],
      meanings: ["Diğer sekmedeki yeni anlam"],
      score: 79,
      updatedAt: new Date(Date.now() + 15_000).toISOString(),
    };
    await route.fallback();
  });
  await page.goto("/");
  await login(page);
  await page.goto("/#library");
  const enable = page.getByRole("button",{name:"Otomatik tamamlamayı aç"});
  await expect(enable).toBeVisible();
  page.once("dialog",dialog=>void dialog.accept());
  await enable.click();
  await expect.poll(() => cloud.requests.filter(req => req.method === "PUT" && req.path.startsWith("/api/words/")).length,
    {timeout:30_000}).toBe(1);
  expect(cloud.libraries[alice][0].meanings).toEqual(["Diğer sekmedeki yeni anlam"]);
  expect(cloud.libraries[alice][0].score).toBe(79);
  expect(cloud.libraries[alice][0].examples).toEqual(initial.examples);
  const maintenance=page.locator("#library-word-controls details");
  await maintenance.locator("summary").click();
  await expect(maintenance).toContainText("başka sekmede değişti");
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


test("authenticated score-free day review sends no writes or Gemini request", async ({ page }) => {
  const cloud = await mockCloud(page);
  const ready = Array.from({ length: 11 }, (_, index) => ({
    ...word("00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"), "Reviewed" + index),
    meanings: ["Ortak anlam"],
    score: 90,
    examples: Array.from({ length: 5 }, (_, i) => ({
      sentence: "The Reviewed" + index + " is example " + i + ".",
      translation: "Örnek " + index + ".",
    })),
  }));
  cloud.libraries[alice] = ready;
  await page.goto("/");
  await login(page);
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  const original = JSON.stringify(cloud.libraries[alice]);
  const originalAccount = JSON.stringify(cloud.accounts[alice]);
  const writesBefore = cloud.requests.filter((request) => request.method !== "GET").length;
  const aiBefore = cloud.requests.filter((request) => request.path.startsWith("/api/ai/")).length;
  await page.getByRole("button", { name: "1. günün kelimelerini puansız tekrar et" }).click();
  await expect(page.locator("#day-review")).toBeVisible();
  const left = page.locator('[data-matching-side="left"]').first();
  const id = await left.getAttribute("data-word-id");
  await left.click();
  await page.locator('[data-matching-side="right"][data-word-id="' + id + '"]').click();
  await page.getByRole("button", { name: "Çık" }).click();
  await expect(page.getByTestId("daily-plan-hero")).toBeVisible();
  expect(cloud.requests.filter((request) => request.method !== "GET")).toHaveLength(writesBefore);
  expect(cloud.requests.filter((request) => request.path.startsWith("/api/ai/"))).toHaveLength(aiBefore);
  expect(JSON.stringify(cloud.libraries[alice])).toBe(original);
  expect(JSON.stringify(cloud.accounts[alice])).toBe(originalAccount);
});


// P0: live React import/retry UI -> /api/ai/words/complete -> /api/words/import
// -> mock owner library GET. Only deterministic fake-cloud data, no hosted writes.
const p0ImportWords = [
  "ability",
  "achieve",
  "adjust",
  "advance",
  "analyze",
  "arrange",
  "approve",
  "balance",
  "clarify",
  "compare",
  "conclude",
  "confirm",
  "consider",
  "create",
  "decide",
  "define",
  "demand",
  "describe",
  "determine",
  "develop",
];
type P0Scenario = "first-compact" | "all-compact" | "all-invalid";

for (const scenario of ["first-compact", "all-compact", "all-invalid"] as const) {
  test(
    "P0 imported partial UI chain " + scenario + " preserves old scores and retries only missing",
    async ({ page }) => {
      const cloud = await mockCloud(page);
      const existing = cloud.libraries[alice][0];
      existing.score = 87;
      existing.meanings = ["Eski kişisel anlam"];
      existing.examples = [
        {
          sentence: "Scholars consider evidence carefully.",
          translation: "Araştırmacılar kanıtı dikkatle değerlendirir.",
          translationFocus: ["kanıtı"],
          source: "Kullanıcı",
        },
      ] as typeof existing.examples;
      const immutable = JSON.stringify(existing);
      const aiCalls: string[][] = [];
      const imported: string[][] = [];
      let retryPhase = false;
      let storedNew = 0;

      await page.route("**/api/ai/words/complete", async (route) => {
        const names = (route.request().postDataJSON() as { words: string[] }).words;
        aiCalls.push(names);
        if (scenario === "all-invalid" && !retryPhase) {
          await route.fulfill({
            status: 502,
            json: { code: "AI_INVALID_RESPONSE", error: "Synthetic rejected envelope" },
          });
          return;
        }
        const compact =
          !retryPhase &&
          (scenario === "all-compact" || (scenario === "first-compact" && aiCalls.length === 1));
        const selected = compact ? names.slice(0, 2) : names;
        await route.fulfill({
          json: {
            provider: "Gemini",
            model: "synthetic-only",
            suggestions: selected.map((name) => ({
              word: name,
              alternatives: [],
              meanings: ["kavram"],
              usageNote: "Sentetik import doğrulaması.",
              partOfSpeech: "Noun",
              cefr: "B2",
              examples: (["easy", "easy", "medium", "yds", "yds"] as const).map(
                (difficulty, index) => ({
                  sentence: "Researchers use " + name + " in example " + index + ".",
                  translation: "Araştırmacılar " + index + ". örnekte kavramı kullanır.",
                  translationFocus: ["kavramı"],
                  difficulty,
                }),
              ),
            })),
          },
        });
      });
      await page.route("**/api/words/import", async (route) => {
        const entries = route.request().postDataJSON() as {
          word: string;
          meanings: string[];
          score?: number;
          examples: { sentence: string }[];
        }[];
        imported.push(entries.map((entry) => entry.word.toLowerCase()));
        expect(
          entries.every((entry) => entry.meanings.length > 0 && entry.examples?.length === 5),
        ).toBe(true);
        let added = 0;
        let duplicates = 0;
        for (const input of entries) {
          if (
            cloud.libraries[alice].some(
              (previous) => previous.word.toLowerCase() === input.word.toLowerCase(),
            )
          ) {
            duplicates++;
            continue;
          }
          cloud.libraries[alice].push({
            ...word(crypto.randomUUID(), input.word),
            ...input,
            score: 0,
          } as ReturnType<typeof word>);
          added++;
          storedNew++;
        }
        await route.fulfill({ json: { added, duplicates } });
      });

      await page.goto("/#library");
      await login(page);
      await page.getByRole("button", { name: "Toplu ekle", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Toplu kelime ekle" });
      await dialog
        .getByRole("textbox", { name: "İngilizce kelime listesi" })
        .fill(p0ImportWords.join("\n"));
      await dialog.getByRole("button", { name: "Yazımı kontrol et" }).click();
      await expect(dialog.locator("#import-accept")).toBeEnabled({ timeout: 30_000 });
      await dialog.locator("#import-accept").click();

      await expect.poll(() => aiCalls.length, { timeout: 30_000 }).toBe(4);
      expect(aiCalls.map((group) => group.length)).toEqual([5, 5, 5, 5]);
      const expectedSaved = scenario === "first-compact" ? 17 : scenario === "all-compact" ? 8 : 0;
      const expectedPending = 20 - expectedSaved;
      await expect(
        dialog.getByText(expectedSaved + " kaydedildi · " + expectedPending + " bekliyor"),
      ).toBeVisible();
      expect(storedNew).toBe(expectedSaved);
      expect(imported.flat()).toHaveLength(expectedSaved);
      expect(JSON.stringify(cloud.libraries[alice][0])).toBe(immutable);
      expect(
        cloud.requests.filter(
          (request) => request.method === "PUT" && request.path.startsWith("/api/words/"),
        ),
      ).toHaveLength(0);
      const firstSaved = cloud.libraries[alice].slice(1).map((entry) => entry.word.toLowerCase());
      expect(new Set(firstSaved).size).toBe(expectedSaved);
      expect(firstSaved.every((key) => p0ImportWords.includes(key))).toBe(true);

      if (scenario === "all-invalid") {
        expect(imported).toHaveLength(0);
        expect(cloud.libraries[alice]).toHaveLength(1);
        return;
      }
      retryPhase = true;
      await dialog.getByRole("button", { name: "AI ile tekrar dene" }).click();
      await expect(dialog).not.toBeVisible({ timeout: 30_000 });
      const remaining = p0ImportWords.filter((wordName) => !firstSaved.includes(wordName));
      expect(
        aiCalls
          .slice(4)
          .flat()
          .map((name) => name.toLowerCase()),
      ).toEqual(remaining);
      expect(cloud.libraries[alice]).toHaveLength(21);
      expect(
        new Set(cloud.libraries[alice].slice(1).map((entry) => entry.word.toLowerCase())).size,
      ).toBe(20);
      expect(JSON.stringify(cloud.libraries[alice][0])).toBe(immutable);
      expect(
        cloud.libraries[alice]
          .slice(1)
          .every((entry) => entry.score === 0 && entry.examples.length === 5),
      ).toBe(true);
      await expect(
        page.getByRole("button", {
          name: "Ability kelime ayrıntıları",
        }),
      ).toBeVisible();
    },
  );
}
