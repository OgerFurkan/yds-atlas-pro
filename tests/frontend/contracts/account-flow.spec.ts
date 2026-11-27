import { mockOrigin } from "../../../frontend/config/playwright/loopback";
import { expect, type Page, test } from "../../../frontend/config/playwright/test-fixtures";
import { createSession } from "../../../packages/shared/src/game-engine";
import type { GameSession } from "../../../packages/shared/src/index";
import { healthyGemini } from "../fixtures/day-study-mock";
import { readyDayWords } from "../fixtures/day-study-words";

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
  const requests: { path: string; method: string; body: unknown; expectedUpdatedAt?: string }[] =
    [];
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
  const mockUsers = new Map<string, ReturnType<typeof authSession>["user"]>();
  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    if (request.url().includes("/token")) {
      const credentials = request.postDataJSON();
      const id = credentials.email.startsWith("bob") ? bob : alice;
      const session = authSession(id, credentials.email);
      mockUsers.set(session.access_token, session.user);
      await route.fulfill({ json: session });
    } else if (request.url().includes("/logout")) await route.fulfill({ status: 204 });
    else if (request.method() === "GET") {
      const bearer = request.headers().authorization?.replace(/^Bearer /, "") ?? "";
      const user = mockUsers.get(bearer);
      if (!user)
        await route.fulfill({ status: 401, json: { message: "Unrecognized mock session" } });
      else await route.fulfill({ json: user });
    } else
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
    if (path === "/api/health") {
      await route.fulfill({ json: healthyGemini });
      return;
    }
    const headers = request.headers();
    const encoded = (headers.authorization ?? "").split(" ")[1]?.split(".")[1];
    const id = encoded ? JSON.parse(atob(encoded)).sub : alice;
    expect(headers.authorization).toMatch(/^Bearer /);
    expect(headers["x-user-id"]).toBeUndefined();
    const body = request.postData() ? request.postDataJSON() : null;
    requests.push({
      path,
      method: request.method(),
      body,
      expectedUpdatedAt: headers["x-atlas-expected-updated-at"],
    });
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
        meanings: body.senses?.find((sense: { word: string }) => sense.word === name)?.meanings
          ?.length
          ? body.senses.find((sense: { word: string }) => sense.word === name).meanings
          : ["Dayanıklı"],
        usageNote: "Örnek kullanım.",
        partOfSpeech:
          body.senses?.find((sense: { word: string }) => sense.word === name)?.partOfSpeech ||
          (name.toLowerCase() === "hello" ? "Interjection" : "Adjective"),
        cefr: "C1",
        examples: Array.from({ length: 5 }, (_, index) => ({
          sentence: `The ${name} example is number ${index}.`,
          translation:
            name.toLowerCase() === "hello"
              ? `${index}. örnekte merhaba denir.`
              : `${index}. örnek dayanıklı.`,
          translationFocus: [name.toLowerCase() === "hello" ? "merhaba" : "dayanıklı"],
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
      expect(body).toEqual({ revision: task.revision });
      task.snapshot.saved = true;
      task.revision += 1;
      if (!task.snapshot.assessmentActions) {
        await route.fulfill({ json: { scores: [], practiceOnly: true } });
        return;
      }
      libraries[id][0].score = 88;
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      accounts[id].progress = [{ day, word_id: libraries[id][0].id }];
      await route.fulfill({
        json: { scores: [{ id: libraries[id][0].id, score: 88 }], practiceOnly: false },
      });
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
    const updateId = /^\/api\/words\/([^/]+)$/.exec(path)?.[1];
    if (updateId && request.method() === "PUT") {
      const index = libraries[id].findIndex((entry) => entry.id === updateId);
      if (index < 0) {
        await route.fulfill({ status: 404, json: { error: "Word not found" } });
        return;
      }
      if (
        headers["x-atlas-expected-updated-at"] &&
        headers["x-atlas-expected-updated-at"] !== libraries[id][index].updatedAt
      ) {
        await route.fulfill({
          status: 409,
          json: { error: "Kelime değişti", code: "WORD_VERSION_CONFLICT" },
        });
        return;
      }
      const updated = {
        ...libraries[id][index],
        ...body,
        id: updateId,
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
    await expect(page.locator("#matching-board [data-word-id]")).toHaveCount(0);
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
    await page.locator("#matching-board").getByText(second.word, { exact: true }).click();
    await page.locator("#matching-board").getByText(second.meanings[0], { exact: true }).click();
    await page.locator("#matching-next").click();
    await expect(page.locator("#question-choices")).toBeVisible();
    await expect(page.locator("#choice-correct, #choice-wrong")).toHaveCount(0);
    const prompt = await page.locator("#question-sentence h2").innerText();
    const term = [first, second].find((item) => item.word === prompt);
    expect(term).toBeDefined();
    await page.locator("#question-choices").getByText(term!.meanings[0], { exact: true }).click();
    await expect(page.locator("#question-next")).toBeEnabled();
    await page.locator("#question-next").click();
    await expect(page.locator("#question-choices button").first()).toBeEnabled();
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
test("chat keeps a mounted account's messages local if the browser session changes before send", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto("/");
  await login(page);
  await page.getByRole("button", { name: "Atlas'a sor" }).click();
  const chat = page.getByRole("dialog", { name: "YDS Atlas Pro Asistanı" });
  // Model the interval between writing a new session and delivering its auth event.
  await page.evaluate(
    (next) => {
      const key = Object.keys(sessionStorage).find(
        (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
      );
      if (!key) throw Error("Synthetic browser session missing");
      sessionStorage.setItem(key, JSON.stringify(next));
    },
    authSession(bob, "bob@example.com"),
  );
  await chat.getByRole("button", { name: "Indicate ne demek?", exact: true }).click();
  await expect(chat.getByText("Oturum değişti. İşlemi yeniden başlat.")).toBeVisible();
  expect(cloud.requests.filter((request) => request.path === "/api/ai/chat")).toHaveLength(0);
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
    await chat.getByRole("button", { name: "Indicate ne demek?", exact: true }).click();
    await expect(chat.getByRole("status")).toBeVisible();
    await chat.getByRole("button", { name: /YDS Atlas AI/ }).click();
    await chat.getByRole("button", { name: "Yeni sohbet" }).click();
    await expect(
      chat.getByRole("heading", {
        name: "Merhaba Ben Atlas, sana nasıl yardımcı olabilirim?",
        exact: true,
      }),
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
  for (const email of ["alice@example.com", null]) {
    await page.getByRole("button", { name: "Hesabım", exact: true }).click();
    await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();
    await expect(page.getByRole("button", { name: "Guest kelime ayrıntıları" })).toBeVisible();
    if (email) {
      await login(page, email);
      await expect(page.getByRole("button", { name: "Evidence kelime ayrıntıları" })).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});
test("incomplete account library preserves the private plan across a retry", async ({ page }) => {
  const cloud = await mockCloud(page);
  const assigned = cloud.libraries[alice][0];
  const excluded = word("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Observe");
  cloud.libraries[alice].push(excluded);
  const plan = {
    ["yds-atlas-daily-word-groups-v1:" + alice]: JSON.stringify([
      { day: 60, words: [assigned.id] },
    ]),
    ["yds-atlas-daily-word-exclusions-v1:" + alice]: JSON.stringify([excluded.id]),
    ["yds-atlas-daily-plan-size-v1:" + alice]: "30",
  };
  let incomplete = true;
  await page.route("**/api/words", async (route) => {
    if (!incomplete || route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 503,
      json: {
        error: "Kelime listesi eksik geldi (1000/1001). Yeniden dene.",
        code: "INCOMPLETE_WORD_LIST",
      },
    });
  });
  await page.goto("/#library");
  await page.evaluate((plan) => {
    for (const [key, value] of Object.entries(plan)) localStorage.setItem(key, value);
  }, plan);
  const readPlan = () =>
    page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), Object.keys(plan));
  await login(page);
  await expect(page.getByText(/Kelime listesi eksik geldi \(1000\/1001\)/)).toBeVisible();
  expect(await readPlan()).toEqual(Object.values(plan));
  incomplete = false;
  await page.getByRole("button", { name: "Yeniden dene" }).click();
  await expect(page.getByRole("button", { name: "Evidence kelime ayrıntıları" })).toBeVisible();
  expect(await readPlan()).toEqual(Object.values(plan));
  expect(cloud.requests.filter(({ method }) => method !== "GET")).toEqual([]);
});

test("failed account reload preserves the cached goal and draft until retry succeeds", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  cloud.accounts[alice].dailyGoal = 50;
  await page.goto("/#library");
  await login(page);
  const libraryWord = page.getByRole("button", { name: "Evidence kelime ayrıntıları" });
  await expect(libraryWord).toBeVisible();
  const goalKey = "yds-atlas-daily-goal:" + alice;
  const draftKey = "yds-atlas-learning-session-v2:" + alice;
  const rawDraft = JSON.stringify(createSession([readyDayWords[0]], 5), null, 2);
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: draftKey,
    raw: rawDraft,
  });
  const stored = () =>
    page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), [goalKey, draftKey]);
  expect(await stored()).toEqual(["50", rawDraft]);

  let unavailable = true;
  await page.route("**/api/account", async (route) => {
    if (!unavailable) return route.fallback();
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      status: 503,
      json: { error: "Günlük hedef yüklenemedi. Yeniden dene." },
    });
  });
  const requestStart = cloud.requests.length;
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Günlük hedef yüklenemedi. Yeniden dene.");
  expect(await stored()).toEqual(["50", rawDraft]);

  unavailable = false;
  await page.getByRole("button", { name: "Yeniden dene" }).click();
  await expect(libraryWord).toBeVisible();
  expect(await stored()).toEqual(["50", rawDraft]);
  const reloadRequests = cloud.requests.slice(requestStart);
  expect(
    reloadRequests.some(({ path, method }) => path === "/api/account" && method === "GET"),
  ).toBe(true);
  expect(
    reloadRequests.filter(
      ({ path, method }) =>
        (path.startsWith("/api/account") || path.startsWith("/api/learning/")) && method !== "GET",
    ),
  ).toEqual([]);
});

test("offline assessment action survives account bootstrap and resumes from the local draft", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  const entry = readyDayWords[0];
  const snapshot = { ...createSession([entry], 5), assessmentActions: [] };
  cloud.accounts[alice].session = { snapshot, revision: 1 };
  await page.route("**/api/learning/session", (route) =>
    route.fulfill({ status: 503, json: { error: "Sentetik bağlantı kesintisi" } }),
  );
  await page.goto("/#game");
  await login(page);
  const resume = page.getByRole("button", { name: "Kaldığım yerden devam et" });
  await resume.click();
  await page.getByRole("button", { name: "Kartı çevir ve anlamı göster" }).click();
  await page.getByRole("button", { name: "Bir sonraki kelime", exact: true }).click();
  const key = "yds-atlas-learning-session-v2:" + alice;
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).assessmentActions.length, key),
    )
    .toBe(1);
  const raw = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.reload();
  await resume.click();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(raw);
  expect(cloud.accounts[alice].session?.revision).toBe(1);
});

for (const terminal of ["completed", "discarded"] as const) {
  test(`reload preserves an unmarked local draft when the cloud session is ${terminal}`, async ({
    page,
  }) => {
    const cloud = await mockCloud(page);
    await page.goto("/#game");
    await login(page);
    const draft: GameSession = {
      ...createSession([readyDayWords[0]], 5),
      phase: "final-context",
      assessmentActions: [{ type: "confidence", value: 20 }],
    };
    const snapshot: GameSession =
      terminal === "discarded"
        ? { ...draft, discarded: true }
        : {
            ...draft,
            phase: "complete",
            queue: [],
            saved: true,
            assessmentActions: [{ type: "confidence", value: 0 }, { type: "advance" }],
          };
    cloud.accounts[alice].session = { snapshot, revision: 7 };
    const keys = {
      draft: "yds-atlas-learning-session-v2:" + alice,
      pending: "yds-atlas-unsent-session-v1:" + alice,
    };
    const raw = JSON.stringify(draft, null, 2);
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: keys.draft, raw });
    const conflict = page
      .getByRole("status")
      .filter({ hasText: "yerel taslak bu cihazda korundu" });
    await page.reload();
    await expect(conflict).toBeVisible();
    await page.getByRole("button", { name: "Yeniden dene" }).click();
    await expect(conflict).toBeVisible();
    expect(
      await page.evaluate(
        (keys) => [localStorage.getItem(keys.draft), localStorage.getItem(keys.pending)],
        keys,
      ),
    ).toEqual([raw, null]);
    await expect(page.getByRole("button", { name: "Kaldığım yerden devam et" })).toHaveCount(0);
    expect(
      cloud.requests.filter((r) => r.path.startsWith("/api/learning/") && r.method !== "GET"),
    ).toEqual([]);
    expect(cloud.accounts[alice].session).toEqual({ snapshot, revision: 7 });
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Taslağı sakla ve bulut oturumunu kullan" }).click();
    await expect(page.getByRole("button", { name: "Hesabım", exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        (owner) => JSON.parse(localStorage.getItem("atlas-preserved-drafts-v1:" + owner)!),
        alice,
      ),
    ).toEqual([raw]);
    expect(
      cloud.requests.filter((r) => r.path.startsWith("/api/learning/") && r.method !== "GET"),
    ).toEqual([]);
  });
}

test("an old account queue cannot send its next goal after Alice signs in again", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: number[] = [];
  await page.route("**/api/account/goal", async (route) => {
    sent.push(route.request().postDataJSON().goal);
    if (sent.length === 1) await held;
    await route.fulfill({ json: { goal: sent.at(-1) } });
  });
  const change = async () => {
    await page.getByRole("button", { name: "Hedefi düzenle" }).click();
    await page.getByRole("button", { name: "Hedefi 10 artır" }).click();
    await page.getByRole("button", { name: "Tamam", exact: true }).click();
  };
  const logout = async () => {
    await page.getByRole("button", { name: "Hesabım", exact: true }).click();
    await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();
    await expect(page.getByRole("button", { name: "Giriş yap", exact: true })).toBeVisible();
  };
  try {
    await page.goto("/");
    await login(page);
    await change();
    await expect.poll(() => sent).toEqual([30]);
    await change();
    await logout();
    await login(page, "bob@example.com");
    await logout();
    await login(page);
    const response = page.waitForEvent("requestfinished", {
      predicate: (r) => r.url().endsWith("/api/account/goal"),
    });
    release();
    await response;
    await change();
    await expect.poll(() => sent).toEqual([30, 30]);
    expect(cloud.accounts[bob].dailyGoal).toBe(20);
  } finally {
    release();
  }
});

test("retrying a partial guest transfer preserves the source and skips accepted words", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  const guest = Array.from({ length: 501 }, (_, i) => word("guest-" + i, "Guestword" + i));
  const raw = JSON.stringify(guest);
  await page.goto("/");
  await page.evaluate((value) => localStorage.setItem("yds-atlas-words-v1", value), raw);
  await login(page);
  const accepted = new Set<string>();
  const sizes: number[] = [];
  await page.route("**/api/words/import", async (route) => {
    const inputs = route.request().postDataJSON() as { word: string }[];
    sizes.push(inputs.length);
    if (sizes.length === 2) {
      await route.fulfill({ status: 503, json: { error: "Sentetik kesinti" } });
      return;
    }
    expect(JSON.parse(atob(route.request().headers().authorization.split(".")[1])).sub).toBe(alice);
    const before = accepted.size;
    for (const input of inputs) accepted.add(input.word);
    await route.fulfill({
      json: { added: accepted.size - before, duplicates: inputs.length - (accepted.size - before) },
    });
  });
  await page.getByRole("button", { name: "Hesabım", exact: true }).click();
  const button = page.getByRole("button", { name: /misafir kelimelerini hesabıma aktar/ });
  await button.click();
  await expect(page.getByText("Sentetik kesinti")).toBeVisible();
  expect(accepted.size).toBe(500);
  await button.click();
  await expect(page.getByText(/Cihazdaki kelimeler aktarıldı/)).toBeVisible();
  expect(sizes).toEqual([500, 1, 500, 1]);
  expect(accepted.size).toBe(501);
  expect(await page.evaluate(() => localStorage.getItem("yds-atlas-words-v1"))).toBe(raw);
  expect(cloud.libraries[bob]).toHaveLength(1);
});

test("guest transfer retries smaller payloads and detects a changed source before showing success", async ({
  page,
}) => {
  await mockCloud(page);
  const key = "yds-atlas-words-v1";
  const guest = [word("guest-1", "First"), word("guest-2", "Second"), word("guest-3", "Third")];
  const changed = JSON.stringify([...guest, word("guest-4", "Fourth")]);
  await page.goto("/");
  await page.evaluate(({ key, guest }) => localStorage.setItem(key, JSON.stringify(guest)), {
    key,
    guest,
  });
  await login(page);
  const sizes: number[] = [];
  const received = new Set<string>();
  await page.route("**/api/words/import", async (route) => {
    const batch = route.request().postDataJSON() as { word: string }[];
    sizes.push(batch.length);
    if (batch.length > 2) {
      await route.fulfill({
        status: 413,
        json: { code: "BODY_TOO_LARGE", error: "İstek çok büyük." },
      });
      return;
    }
    const before = received.size;
    for (const entry of batch) received.add(entry.word);
    if (sizes.length === 3)
      await page.evaluate(({ key, changed }) => localStorage.setItem(key, changed), {
        key,
        changed,
      });
    const added = received.size - before;
    await route.fulfill({ json: { added, duplicates: batch.length - added } });
  });
  await page.getByRole("button", { name: "Hesabım", exact: true }).click();
  const submit = page.getByRole("button", { name: /misafir kelimelerini hesabıma aktar/ });
  await submit.click();
  await expect(page.getByText(/Misafir kütüphanesi değişti/)).toBeVisible();
  expect(sizes).toEqual([3, 2, 1]);
  await submit.click();
  await expect(page.getByText(/Cihazdaki kelimeler aktarıldı/)).toBeVisible();
  expect(sizes.slice(3)).toEqual([4, 2, 2]);
  expect(received.size).toBe(4);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(changed);
});

test("a queued guest plan change cannot initialize either library after login", async ({
  page,
  context,
}) => {
  await mockCloud(page);
  const holder = await context.newPage();
  await mockCloud(holder);
  await holder.goto("/");
  await page.goto("/#library");
  await page.getByRole("tab", { name: /Günlük Plan/ }).click();
  const key = "yds-atlas-words-v1";
  await holder.evaluate(
    (key) =>
      new Promise<void>((held) => {
        void navigator.locks.request(key, async () => {
          held();
          await new Promise((resolve) =>
            window.addEventListener("release-guest", resolve, { once: true }),
          );
        });
      }),
    key,
  );
  await page.getByRole("button", { name: "40", exact: true }).click();
  await expect
    .poll(() =>
      holder.evaluate(
        async (key) => (await navigator.locks.query()).pending?.some((lock) => lock.name === key),
        key,
      ),
    )
    .toBe(true);
  await login(page);
  await holder.evaluate(async (key) => {
    window.dispatchEvent(new Event("release-guest"));
    await navigator.locks.request(key, () => {});
  }, key);
  expect(
    await page.evaluate(
      ({ key, owner }) =>
        [
          key,
          key + ":" + owner,
          "yds-atlas-daily-plan-size-v1",
          "yds-atlas-daily-plan-size-v1:" + owner,
        ].map((k) => localStorage.getItem(k)),
      { key, owner: alice },
    ),
  ).toEqual([null, null, null, null]);
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
    path: test.info().outputPath(`ai-preview-${test.info().project.name}.png`),
    fullPage: true,
  });
  expect(cloud.libraries[alice]).toHaveLength(1);
  await dialog.getByRole("button", { name: "İnceledim, öneriyi forma aktar" }).click();
  expect(cloud.libraries[alice]).toHaveLength(1);
  await dialog.getByRole("button", { name: "Manuel kaydet", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Resilient kelime ayrıntıları" })).toBeVisible();
  expect(cloud.libraries[alice]).toHaveLength(2);
  const saved = cloud.requests.find(
    (request) => request.path === "/api/words" && request.method === "POST",
  )!.body as { examples: { translationFocus: string[]; source: string }[]; score: number };
  expect(saved.examples[0].translationFocus.map((focus) => focus.toLocaleLowerCase("tr"))).toEqual([
    "dayanıklı",
  ]);
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
  const saveButton = dialog.getByRole("button", { name: "AI ile kaydet", exact: true });
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

test("Hello with a typed Turkish meaning keeps it when AI saves five examples", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto("/");
  await login(page);
  await page.getByRole("button", { name: "Kelime ekle", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /İngilizce kelime/ }).fill("hello");
  await dialog.getByRole("textbox", { name: /Türkçe anlam/ }).fill("merhaba");
  await dialog.getByRole("button", { name: "AI ile kaydet", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const generation = cloud.requests.find(({ path }) => path === "/api/ai/words/complete");
  expect(generation?.body).toMatchObject({ senses: [{ word: "Hello", meanings: ["merhaba"] }] });
  const saved = cloud.libraries[alice].find(({ word }) => word.toLowerCase() === "hello");
  expect(saved?.meanings).toEqual(["merhaba"]);
  expect(saved?.examples).toHaveLength(5);
  expect(saved?.partOfSpeech).toBe("Interjection");
  expect(saved?.examples.every(({ translation }) => translation.includes("merhaba"))).toBe(true);
});

test("authorized Settings shows a safe Gemini error and retries", async ({ page }) => {
  await mockCloud(page);
  let allowed = true;
  let calls = 0;
  await page.route("**/api/control", (route) =>
    route.fulfill(
      allowed ? { json: { authorized: true } } : { status: 403, json: { code: "CONTROL_DENIED" } },
    ),
  );
  await page.route("**/api/control/ai-status", (route) =>
    route.fulfill(
      ++calls === 1
        ? { status: 503, json: { error: "raw fixture diagnostic" } }
        : { json: { keys: [], lastKey: null, pause: null } },
    ),
  );
  await page.goto("/");
  await login(page);
  const settings = page
    .getByRole("button", { name: "Ayarlar", exact: true })
    .filter({ visible: true });
  if (!(await settings.isVisible())) await page.getByRole("button", { name: "Menüyü aç" }).click();
  await settings.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toHaveText("Gemini durum bilgisi yüklenemedi.");
  await expect(dialog.getByText("raw fixture diagnostic")).toHaveCount(0);
  await dialog.getByRole("button", { name: /Yeniden kontrol/ }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Gemini teknik durumu" })).toBeVisible();
  expect(calls).toBe(2);
  await page.keyboard.press("Escape");
  allowed = false;
  if (!(await settings.isVisible())) await page.getByRole("button", { name: "Menüyü aç" }).click();
  await settings.click();
  await expect(dialog.getByRole("heading", { name: "Gemini teknik durumu" })).toHaveCount(0);
  expect(calls).toBe(2);
});

test("six confirmed legacy words auto-upgrade on opening the library, preserving examples and scores", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  const names = ["Evidence", "Obtain", "Adapt", "Analyze", "Maintain", "Clarify"];
  const initial = names.map((name, index) => ({
    ...word("00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"), name),
    score: 25 + index,
    meanings: ["Kişisel anlam " + index],
    examples: [
      {
        sentence: "Learners use " + name.toLowerCase() + " in context.",
        translation: "Önceki örnek " + index + ".",
        translationFocus: ["Önceki"],
        source: "Kullanıcı",
      },
    ],
  }));
  cloud.libraries[alice] = initial as unknown as ReturnType<typeof word>[];
  await page.goto("/");
  await login(page);
  await page.goto("/#library");
  // The account owner grants explicit consent once; subsequent tier completion
  // and shared dictionary warmup run without the two legacy operation banners.
  expect(cloud.requests.some((req) => req.method === "PUT")).toBe(false);
  const enable = page.getByRole("button", { name: "Eski örnekleri tamamla" });
  await expect(enable).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await enable.click();
  await expect
    .poll(
      () =>
        cloud.requests.filter((req) => req.path.startsWith("/api/words/") && req.method === "PUT")
          .length,
      { timeout: 30_000 },
    )
    .toBe(6);
  const saves = cloud.requests.filter(
    (req) => req.path.startsWith("/api/words/") && req.method === "PUT",
  );
  expect(saves).toHaveLength(6);
  expect(saves.every((req) => typeof req.expectedUpdatedAt === "string")).toBe(true);
  const completions = cloud.requests.filter((req) => req.path === "/api/ai/words/complete");
  expect(completions).toHaveLength(2);
  expect((completions[0].body as { words: string[] }).words).toHaveLength(5);
  expect((completions[1].body as { words: string[] }).words).toHaveLength(1);
  for (const [index, name] of names.entries()) {
    // The mock library intentionally replaces array entries after PUT; compare
    // with immutable pre-operation fixtures, not aliased in-memory objects.
    const originalId = "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0");
    const actual = cloud.libraries[alice].find((entry) => entry.id === originalId);
    expect(actual).toBeDefined();
    expect(actual!.score).toBe(25 + index);
    expect(actual!.meanings).toEqual(["Kişisel anlam " + index]);
    const savedExamples = actual!.examples as Array<{
      sentence: string;
      source?: string;
      difficulty?: string;
    }>;
    expect(savedExamples.slice(0, 5).map((e) => e.difficulty)).toEqual([
      "easy",
      "easy",
      "medium",
      "yds",
      "yds",
    ]);
    expect(savedExamples[5].sentence).toBe("Learners use " + name.toLowerCase() + " in context.");
    expect(savedExamples[5].source).toBe("Kullanıcı");
  }
});

test("automatic legacy repair stops on a simulated concurrent tab edit", async ({ page }) => {
  const cloud = await mockCloud(page);
  const initial = {
    ...word("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Evidence"),
    meanings: ["Eski anlam"],
    score: 18,
    examples: [
      {
        sentence: "My original evidence matters.",
        translation: "Kendi çevirim.",
        source: "Kullanıcı",
      },
    ],
  };
  cloud.libraries[alice] = [initial];
  await page.route("**/api/words/*", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }
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
  const enable = page.getByRole("button", { name: "Eski örnekleri tamamla" });
  await expect(enable).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await enable.click();
  await expect
    .poll(
      () =>
        cloud.requests.filter((req) => req.method === "PUT" && req.path.startsWith("/api/words/"))
          .length,
      { timeout: 30_000 },
    )
    .toBe(1);
  expect(cloud.libraries[alice][0].meanings).toEqual(["Diğer sekmedeki yeni anlam"]);
  expect(cloud.libraries[alice][0].score).toBe(79);
  expect(cloud.libraries[alice][0].examples).toEqual(initial.examples);
  const maintenance = page.locator("#library-word-controls details");
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

test("online assessment restores the current question without a browser draft", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        ...cloud.accounts[alice],
        onlineProtocol: 1,
      },
    }),
  );
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const routeName = "/api/learning/online";
  const token = "0123456789abcdef0123456789abcdef";
  let cancelled = false;
  const question = {
    id,
    revision: 3,
    phase: "final-meaning",
    status: "active",
    total: 5,
    group: 1,
    done: 0,
    prompt: "Evidence",
    choices: [{ token, text: "Kanıt" }],
  };
  await page.route("**" + routeName + "**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        json:
          new URL(request.url()).pathname === routeName
            ? { current: cancelled ? null : question }
            : question,
      });
      return;
    }
    expect(new URL(request.url()).pathname).toBe(routeName + "/" + id);
    expect(request.postDataJSON()).toMatchObject({ revision: 3, action: { kind: "cancel" } });
    cancelled = true;
    await route.fulfill({
      json: { ...question, status: "cancelled", revision: 4, choices: undefined },
    });
  });
  await page.goto("/");
  await login(page);
  await page.goto("/#game");
  await expect(page.getByRole("button", { name: "Kanıt", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Kanıt", exact: true })).toBeEnabled();
  expect(
    cloud.requests.filter(
      (request) => request.path === "/api/learning/session" && request.method !== "GET",
    ),
  ).toEqual([]);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "İptal et", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Değerlendirme iptal edildi" })).toBeVisible();
});

test("a signed-in account finishes local practice completely offline without recording a score", async ({
  page,
  context,
}) => {
  const cloud = await mockCloud(page);
  const entry = readyDayWords[0];
  cloud.libraries[alice] = [entry];
  await page.route("**/api/account", (route) =>
    route.fulfill({ json: { ...cloud.accounts[alice], onlineProtocol: 1 } }),
  );
  await page.route("**/api/learning/online", (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await login(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Hedefe Başla" }).click();
  await page.getByRole("button", { name: "Puansız pratik", exact: true }).click();
  await page.getByRole("tab", { name: "Kütüphanem" }).click();
  await page.getByRole("button", { name: "Mevcut 1 kelimeyle kısa görev başlat" }).click();
  const key = "yds-atlas-learning-session-v2:" + alice;
  const draft = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as GameSession, key);
  await page.getByRole("button", { name: "Kartı çevir ve anlamı göster" }).click();
  await page.locator("#flashcard-next").click();
  await expect.poll(async () => (await draft()).phase).toBe("matching");
  for (let i = 0; i < 8; i++) {
    const session = await draft();
    expect(session.localPractice).toBe(true);
    if (session.phase === "complete") break;
    if (session.phase.endsWith("matching")) {
      await page.locator("#matching-board").getByText(entry.word, { exact: true }).click();
      await page.locator("#matching-board").getByText(entry.meanings[0], { exact: true }).click();
      await page.locator("#matching-next").click();
    } else {
      const correct = session.phase.endsWith("meaning") ? entry.meanings[0] : entry.word;
      await page.locator("#question-choices").getByText(correct, { exact: true }).click();
      if (session.phase.startsWith("final-"))
        await page.getByRole("button", { name: "Kolay hatırladım" }).click();
      await page.locator("#question-next").click();
    }
    await expect.poll(async () => (await draft()).phase).not.toBe(session.phase);
  }
  await expect.poll(async () => (await draft()).saved).toBe(true);
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("button", { name: "Hesabım", exact: true }).waitFor();
  expect((await draft()).saved).toBe(true);
  expect(
    cloud.requests.filter(
      ({ path, method }) => path.startsWith("/api/learning") && method !== "GET",
    ),
  ).toEqual([]);
  expect(cloud.accounts[alice].progress).toEqual([]);
  expect(cloud.libraries[alice][0].score).toBe(entry.score);
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
    assessmentActions: [
      { type: "advance" },
      { type: "answer", choice: "Genişlemek" },
      { type: "advance" },
      { type: "answer", choice: "Expand" },
      { type: "advance" },
      { type: "match", side: "left", id: entry.id },
      { type: "match", side: "right", id: entry.id },
      { type: "match-next" },
      { type: "answer", choice: "Genişlemek" },
      { type: "confidence", value: 0 },
      { type: "advance" },
      { type: "answer", choice: "Expand" },
      { type: "confidence", value: 0 },
    ],
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
  expect(cloud.accounts[alice].session?.snapshot.assessmentActions?.at(-1)).toEqual({
    type: "advance",
  });
  expect(cloud.libraries[alice][0].score).toBe(88);
  await page.reload();
  await page.goto("/#library");
  await expect(page.getByRole("button", { name: "Expand kelime ayrıntıları" })).toBeVisible();
  const completed = cloud.requests.filter((request) => request.path.endsWith("/complete"));
  expect(completed).toHaveLength(1);
});

test("discarded cloud task does not reappear after reloading", async ({ page }) => {
  const cloud = await mockCloud(page);
  const entry = cloud.libraries[alice][0];
  const snapshot: GameSession = {
    version: 3,
    groupMatching: false,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    words: [entry],
    batchSize: 5,
    groupIndex: 0,
    phase: "flashcards",
    queue: [entry.id],
    stageCompleted: 0,
    attempts: {},
    scoreChanges: {},
    assessment: {},
    matching: null,
    answer: null,
    finalCorrect: 0,
    finalTotal: 0,
    tutorial: false,
    saved: false,
  };
  cloud.accounts[alice].session = { snapshot, revision: 3 };
  await page.goto("/#game");
  await login(page);
  await page.getByRole("button", { name: "Görevi iptal et" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Çalışmayı sonlandır?" });
  await confirmation.getByRole("button", { name: "Çalışmaya devam et" }).click();
  expect(cloud.accounts[alice].session?.revision).toBe(3);
  await page.getByRole("button", { name: "Görevi iptal et" }).click();
  await confirmation.getByRole("button", { name: "Çalışmayı sonlandır" }).click();
  const resume = page.getByRole("button", { name: "Kaldığım yerden devam et" });
  await expect(resume).toHaveCount(0);
  expect(cloud.accounts[alice].session).toMatchObject({
    snapshot: { id: snapshot.id, discarded: true, saved: false },
    revision: 4,
  });
  expect(cloud.accounts[alice].progress).toEqual([]);
  expect(cloud.libraries[alice][0].score).toBe(0);
  await page.reload();
  await expect(page.locator("#task-intro")).toBeVisible();
  await expect(resume).toHaveCount(0);
});

test("one Study click uses the verified pool before AI, saves missing fields and opens the day", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  const own = {
    ...cloud.libraries[alice][0],
    meanings: ["Kanıt"],
    usageNote: "My private note",
    score: 37,
  };
  const missing = {
    ...word("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "Reliable"),
    meanings: [],
    partOfSpeech: "",
  };
  cloud.libraries[alice] = [own, missing];
  const lookups: string[] = [];
  await page.route(/\/api\/lexicon\/inspect(?:\?|$)/, async (route) => {
    const name = new URL(route.request().url()).searchParams.get("word")!;
    lookups.push(name);
    if (name !== "evidence") return route.fulfill({ json: { status: "missing", word: name } });
    return route.fulfill({
      json: {
        status: "ready",
        word: name,
        entry: {
          id: own.id,
          word: name,
          revision: 1,
          status: "human_reviewed",
          partOfSpeech: "Noun",
          meaning: "Kanıt",
          meanings: ["Kanıt"],
          senseKey: "proof",
          alternatives: [],
          usageNote: "",
          cefr: "B2",
          pronunciationUk: null,
          pronunciationUs: null,
          examples: ["easy", "easy", "medium", "yds", "yds"].map((difficulty, i) => ({
            difficulty,
            sentence: `Evidence supports the claim in report ${i}.`,
            translation: "Kanıt iddiayı destekler.",
            translationFocus: ["Kanıt"],
          })),
        },
      },
    });
  });
  await page.goto("/");
  await login(page);
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günü hazırla ve çalış" }).click();
  await expect(page.getByRole("button", { name: "Kartı çevir ve anlamı göster" })).toBeVisible();
  expect(lookups.sort()).toEqual(["evidence", "reliable"]);
  expect(
    cloud.requests
      .filter((request) => request.path === "/api/ai/words/complete")
      .map((request) => request.body),
  ).toEqual([{ words: ["Reliable"] }]);
  expect(cloud.libraries[alice][0]).toMatchObject({
    meanings: own.meanings,
    usageNote: own.usageNote,
    score: 37,
  });
  expect(cloud.libraries[alice][0].examples).toHaveLength(5);
  expect(cloud.libraries[alice][1].examples).toHaveLength(5);
  expect(cloud.libraries[bob][0].examples).toHaveLength(0);
});

test("day preparation cancels late results and reports a quota error on retry", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  cloud.libraries[alice] = [
    { ...word("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "Reliable"), partOfSpeech: "" },
  ];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/api/ai/words/complete", async (route) => {
    if (++requests === 1) {
      await gate;
      await route
        .fulfill({
          json: {
            provider: "Gemini",
            model: "test",
            suggestions: [
              {
                word: "Reliable",
                alternatives: [],
                meanings: ["Güvenilir"],
                partOfSpeech: "Adjective",
                usageNote: "Bir kişinin veya kaynağın güvenilirliğini anlatır.",
                cefr: "B2",
                examples: ["easy", "easy", "medium", "yds", "yds"].map((difficulty, i) => ({
                  difficulty,
                  sentence: `This reliable example is number ${i}.`,
                  translation: "Bu güvenilir bir örnektir.",
                  translationFocus: ["güvenilir"],
                })),
              },
            ],
          },
        })
        .catch(() => {});
      return;
    }
    await route
      .fulfill({ status: 429, json: { code: "AI_QUOTA_EXCEEDED", error: "Test kota sınırı" } })
      .catch(() => {});
  });
  try {
    await page.goto("/");
    await login(page);
    await page.goto("/#library");
    await page.getByRole("tab", { name: "Günlük Plan" }).click();
    const study = page.getByRole("button", { name: "1. günü hazırla ve çalış" });
    await study.click();
    await expect.poll(() => requests).toBe(1);
    await expect(study).toBeDisabled();
    await expect(
      page.getByRole("progressbar", { name: "Kelime hazırlama ilerlemesi" }),
    ).toHaveAttribute("value", "0");
    await page.getByRole("button", { name: "Hazırlığı iptal et" }).click();
    release();
    await expect(page).toHaveURL(/#library$/);
    expect(cloud.requests.filter((request) => request.method === "PUT")).toHaveLength(0);
    await expect(async () => {
      if (requests === 1) await study.click();
      await expect.poll(() => requests, { timeout: 500 }).toBe(2);
    }).toPass();
    await expect(page.getByRole("alert").filter({ hasText: "Test kota sınırı" })).toBeVisible();
    await expect(page).toHaveURL(/#library$/);
    await expect(page.getByRole("button", { name: "1. günün kelimeleriyle çalış" })).toBeDisabled();
  } finally {
    release();
  }
});

test("day preparation timeout leaves the day visible and stops the progress indicator", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms) =>
      ms === 120_000
        ? AbortSignal.abort(new DOMException("Test deadline", "TimeoutError"))
        : timeout(ms);
  });
  await page.goto("/");
  await login(page);
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günü hazırla ve çalış" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /Hazırlık zaman aşımına uğradı/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /Hazırlık zaman aşımına uğradı/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Hazırlığı iptal et" })).toHaveCount(0);
  await expect(page).toHaveURL(/#library$/);
  expect(
    cloud.requests.filter(({ method, path }) => method === "PUT" || path.startsWith("/api/ai/")),
  ).toHaveLength(0);
});

test("clearing an account day during an unfinished task preserves the game and the library after reload", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  const original = {
    ...cloud.libraries[alice][0],
    score: 35,
    examples: Array.from({ length: 5 }, (_, i) => ({
      sentence: `Evidence supports report ${i}.`,
      translation: "Kanıt raporu destekler.",
      translationFocus: ["Kanıt"],
      difficulty: ["easy", "easy", "medium", "yds", "yds"][i],
    })),
  };
  cloud.libraries[alice] = [original];
  await page.goto("/");
  await login(page);
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günün kelimeleriyle çalış" }).click();
  await expect.poll(() => cloud.accounts[alice].session?.revision).toBe(1);
  const previousTask = cloud.accounts[alice].session;
  await page.goto("/#library");
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await page.getByRole("button", { name: "1. günü düzenle veya sil" }).click();
  const confirm = page.getByRole("alertdialog", { name: "1. günü düzenle veya sil" });
  await expect(confirm).toContainText("Yarım kalan görevin korunacak.");
  await expect(confirm.getByRole("radio", { name: /Günü ve kelimeleri sil/ })).toBeDisabled();
  await confirm.getByRole("button", { name: "Günü temizle" }).click();
  await expect(page.getByRole("button", { name: "1. güne kelime ekle" })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Günlük Plan" }).click();
  await expect(page.getByRole("button", { name: "1. güne kelime ekle" })).toBeVisible();
  expect(cloud.accounts[alice].session).toEqual(previousTask);
  expect(cloud.libraries[alice]).toEqual([original]);
  expect(cloud.requests.filter(({ method }) => method === "DELETE")).toEqual([]);
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
  expect(cloud.requests.filter((request) => request.path.startsWith("/api/ai/"))).toHaveLength(
    aiBefore,
  );
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
            failures: names
              .slice(selected.length)
              .map((word, index) => ({ word, reason: index === 0 ? "wrong_sense" : "examples" })),
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
      const failures = dialog.getByRole("list", { name: "Tamamlanamayan kelimeler" });
      await expect(failures.getByText(/İstenen Türkçe anlam/).first()).toBeVisible();
      await expect(failures.getByText(/2 kolay, 1 orta ve 2 YDS/).first()).toBeVisible();
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

test("two independent devices preserve their day plans across a lost acknowledgement and conflict", async ({
  page,
  browser,
}) => {
  const device = await browser.newContext({
    baseURL: mockOrigin,
    serviceWorkers: "block",
  });
  const other = await device.newPage();
  let revision = 0;
  let accepted = "";
  let plan: unknown = null;
  let loseReply = true;
  const key = "yds-atlas-daily-word-groups-v1:" + alice;
  async function prepare(p: Page, day: number, reloadOnly = false) {
    const mock = await mockCloud(p);
    Object.assign(mock.accounts[alice], { planProtocol: 1 });
    await p.route("**/api/account/plan", async (route) => {
      const req = route.request();
      if (req.method() === "PUT") {
        const input = req.postDataJSON();
        expect(input.owner).toBe(alice);
        if (input.command !== accepted) {
          if (input.revision !== revision)
            return route.fulfill({
              status: 409,
              json: { code: "PLAN_CONFLICT", error: "Plan değişti." },
            });
          revision++;
          plan = input.plan;
          accepted = input.command;
          if (loseReply) {
            loseReply = false;
            return route.abort("failed");
          }
        }
      }
      return route.fulfill({ json: { owner: alice, revision, plan } });
    });
    await p.goto("/#library");
    if (reloadOnly) {
      await login(p);
      return;
    }
    await p.evaluate(
      ({ key, day }) =>
        localStorage.setItem(
          key,
          JSON.stringify([
            {
              day,
              words:
                day === 60
                  ? ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "legacy-device-only-word"]
                  : ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
            },
          ]),
        ),
      { key, day },
    );
    await login(p);
    await expect(p.getByRole("button", { name: "Cihazdaki planı hesaba aktar" })).toBeVisible();
  }
  try {
    await Promise.all([prepare(page, 60), prepare(other, 1)]);
    await expect(page.getByText(/Kütüphanede bulunmayan 1 kayıt/)).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Cihazdaki planı hesaba aktar" }).click();
    await expect(page.getByRole("button", { name: "Aynı işlemi yeniden doğrula" })).toBeVisible();
    const context = page.context();
    const raw = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.close();
    page = await context.newPage();
    await prepare(page, 60, true);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(raw);
    await page.getByRole("button", { name: "Aynı işlemi yeniden doğrula" }).click();
    await expect(page.getByRole("button", { name: "Aynı işlemi yeniden doğrula" })).toHaveCount(0);
    await other.getByRole("button", { name: "Cihazdaki planı hesaba aktar" }).click();
    await expect(other.getByText("Plan değişti.", { exact: true })).toBeVisible();
    other.once("dialog", (d) => d.accept());
    await other.getByRole("button", { name: "Güncel hesap planını kullan" }).click();
    await other.getByRole("button", { name: "Hesaptaki planı kullan" }).click();
    expect(revision).toBe(1);
    expect(plan).toMatchObject({
      groups: [{ day: 60, words: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }],
    });
    expect(
      JSON.parse(await other.evaluate((key) => localStorage.getItem(key)!, key)),
    ).toMatchObject([{ day: 1 }]);
  } finally {
    await device.close();
  }
});

test("bounded account pages discard the first revision on conflict before displaying words", async ({
  page,
}) => {
  const mock = await mockCloud(page);
  const original = mock.libraries[alice][0];
  const second = word("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Second");
  let generation = 0,
    calls = 0;
  await page.route("**/api/words", (route) =>
    route.fulfill({
      status: 413,
      json: { code: "WORD_LIST_LIMIT", error: "Bounded transport required" },
    }),
  );
  await page.route("**/api/words/page", (route) => {
    calls++;
    const { cursor } = route.request().postDataJSON();
    if (!cursor) generation++;
    if (cursor && generation === 1)
      return route.fulfill({ status: 409, json: { code: "WORD_LIST_CHANGED", error: "Retry" } });
    const row = cursor ? second : { ...original, word: generation === 1 ? "Stale" : "Current" };
    return route.fulfill({
      json: {
        owner: alice,
        revision: String(generation),
        total: cursor ? null : 2,
        words: [row],
        cursor: { owner: alice, revision: String(generation), id: row.id, time: row.updatedAt },
      },
    });
  });
  await page.goto("/#library");
  await login(page);
  await expect(page.getByRole("button", { name: "Current kelime ayrıntıları" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Second kelime ayrıntıları" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stale kelime ayrıntıları" })).toHaveCount(0);
  expect(calls).toBe(4);
});
