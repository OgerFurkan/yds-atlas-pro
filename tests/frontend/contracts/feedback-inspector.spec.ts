import { expect, type Page, test } from "../../../frontend/playwright-test";

const owner = "11111111-1111-4111-8111-111111111111";
const entryId = "22222222-2222-4222-8222-222222222222";
const wordId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function session() {
  const payload = (data: Record<string, unknown>) => btoa(JSON.stringify(data));
  const access_token = [
    payload({ alg: "HS256", typ: "JWT" }),
    payload({ sub: owner, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
    "contract-signature",
  ].join(".");
  return {
    access_token,
    refresh_token: "offline-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: owner,
      aud: "authenticated",
      role: "authenticated",
      email: "alice@example.com",
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
    },
  };
}
const tiers = ["easy", "easy", "medium", "yds", "yds"] as const;
const examples = tiers.map((difficulty, i) => ({
  sentence: `Students obtain evidence during carefully structured language study ${i + 1}.`,
  translation: `Öğrenciler ${i + 1}. çalışmada kanıt elde eder.`,
  difficulty,
  translationFocus: ["elde eder"],
}));
const choice = {
  id: entryId,
  word: "obtain",
  partOfSpeech: "Verb",
  meaning: "elde etmek",
  revision: 2,
  status: "machine_validated",
} as const;
const entry = {
  ...choice,
  senseKey: "a".repeat(64),
  meanings: ["elde etmek"],
  alternatives: [],
  usageNote: "",
  cefr: "B1",
  examples,
  pronunciationUk: null,
  pronunciationUs: null,
};
async function mockInspectorCloud(
  page: Page,
  savedAccountSession: unknown = null,
  provider:
    | "FreeDictionaryAPI.com / Wiktionary"
    | "Wiktapi / Turkish Wiktionary" = "FreeDictionaryAPI.com / Wiktionary",
  libraryWords: unknown[] = [],
) {
  const seen: { path: string; method: string; body: unknown; authenticated: boolean }[] = [];
  const currentSession = session();
  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    if (request.url().includes("/token")) await route.fulfill({ json: currentSession });
    else if (request.url().includes("/logout")) await route.fulfill({ status: 204 });
    else if (request.method() === "GET") await route.fulfill({ json: currentSession.user });
    else await route.fulfill({ json: { user: currentSession.user, session: null } });
  });
  await page.route("http://127.0.0.1:5178/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData() ? request.postDataJSON() : null;
    const authenticated =
      request.headers().authorization === `Bearer ${currentSession.access_token}`;
    seen.push({ path: url.pathname, method: request.method(), body, authenticated });
    // A guest bootstrap request is not a valid session. Fail closed rather than
    // returning a user account or privileged Lexicon response without a token.
    if (!authenticated) {
      await route.fulfill({
        status: 401,
        json: { code: "UNAUTHENTICATED", error: "Oturum gerekli." },
      });
      return;
    }
    if (url.pathname === "/api/account") {
      await route.fulfill({
        json: { dailyGoal: 20, session: savedAccountSession, progress: [], completedDays: [] },
      });
    } else if (url.pathname === "/api/words" && request.method() === "GET") {
      await route.fulfill({ json: libraryWords });
    } else if (url.pathname === "/api/lexicon/inspect") {
      expect(request.method()).toBe("GET");
      const word = url.searchParams.get("word");
      const sense = url.searchParams.get("meaning");
      await route.fulfill({
        json:
          word === "evidence"
            ? { status: "missing", word: "evidence" }
            : sense === "elde etmek"
              ? { status: "ready", word: "obtain", entry }
              : {
                  status: "choices",
                  word: "obtain",
                  choices: [
                    choice,
                    { ...choice, id: "33333333-3333-4333-8333-333333333333", meaning: "sağlamak" },
                  ],
                },
      });
    } else if (url.pathname === "/api/dictionary/turkish") {
      expect(request.method()).toBe("GET");
      expect(url.searchParams.get("word")).toBe("evidence");
      await route.fulfill({
        json: {
          status: "ready",
          word: "evidence",
          entries: [{ partOfSpeech: "noun", meanings: ["kanıt"] }],
          source: {
            provider,
            url:
              provider === "Wiktapi / Turkish Wiktionary"
                ? "https://tr.wiktionary.org/wiki/evidence"
                : "https://en.wiktionary.org/wiki/evidence",
            license: "CC BY-SA 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
          },
        },
      });
    } else if (url.pathname === "/api/lexicon/examples/draft") {
      expect(request.method()).toBe("POST");
      expect(body).toEqual({ word: "obtain" });
      await route.fulfill({ json: { status: "draft", word: "obtain", examples } });
    } else if (url.pathname === "/api/words/import") {
      await route.fulfill({ json: { added: 1, duplicates: 0 } });
    } else {
      await route.fulfill({ status: 404, json: { code: "UNMOCKED_ENDPOINT" } });
    }
  });
  return seen;
}
async function login(page: Page) {
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  const form = page.getByRole("form", { name: "Hesap giriş formu" });
  await form.getByLabel("E-posta adresi").fill("alice@example.com");
  await form.getByLabel("Şifre", { exact: true }).fill("offline-password");
  await form.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hesabım", exact: true })).toBeVisible();
}

test("Word Inspector chooses explicit sense, shows exact 2/1/2 tiers and saves only on click", async ({
  page,
}) => {
  const seen = await mockInspectorCloud(page);
  await page.goto("/#inspector");
  // Deliberately send a request without a Bearer token: the mock must deny it.
  const anonymous = await page.evaluate(async () => {
    const response = await fetch("/api/lexicon/inspect?word=obtain");
    return { status: response.status, code: (await response.json()).code };
  });
  expect(anonymous).toEqual({ status: 401, code: "UNAUTHENTICATED" });
  await login(page);
  await expect(page.getByRole("heading", { name: "Kelimeyi derinlemesine incele" })).toBeVisible();
  await page.getByRole("searchbox", { name: "İngilizce kelime veya ifade" }).fill("obtain");
  await page.getByRole("button", { name: "Havuzda incele" }).click();
  await expect(page.getByRole("heading", { name: "Doğru anlamı seç" })).toBeVisible();
  expect(seen.filter((x) => x.path === "/api/words/import")).toHaveLength(0);
  await page.getByRole("button", { name: /Verb.*elde etmek/ }).click();
  expect(seen.filter((x) => x.path === "/api/lexicon/inspect" && x.authenticated)).toHaveLength(2);
  await expect(page.getByRole("heading", { name: "Beş kademeli örnek" })).toBeVisible();
  const exampleRows = page
    .getByRole("list", { name: "Inspector örnekleri" })
    .locator(":scope > li");
  await expect(exampleRows).toHaveCount(5);
  for (const [i, label] of ["Kolay", "Kolay", "Orta", "YDS", "YDS"].entries()) {
    await expect(exampleRows.nth(i)).toContainText(label);
  }
  expect(seen.filter((x) => x.path === "/api/words/import")).toHaveLength(0);
  await page.getByRole("button", { name: "Kütüphaneye ekle" }).click();
  await expect(page.getByText("Kelime kütüphanene eklendi.")).toBeVisible();
  const saves = seen.filter((x) => x.path === "/api/words/import");
  expect(saves).toHaveLength(1);
  const input = (
    saves[0].body as Array<{ lexicon: unknown; score: number; examples: unknown[] }>
  )[0];
  expect(input.lexicon).toEqual({ entryId, revision: 2, contractVersion: 1 });
  expect(input.score).toBe(0);
  expect(input.examples).toHaveLength(5);
  expect(seen.filter((x) => /\/api\/ai\//.test(x.path))).toHaveLength(0);
});

test("sentence tap shows licensed Turkish meaning for a missing word, and five translations are opt-in", async ({
  page,
}) => {
  const seen = await mockInspectorCloud(page);
  await page.goto("/#inspector");
  await login(page);
  await page.getByRole("searchbox", { name: "İngilizce kelime veya ifade" }).fill("obtain");
  await page.getByRole("button", { name: "Havuzda incele" }).click();
  await page.getByRole("button", { name: /Verb.*elde etmek/ }).click();
  const examplesList = page.getByRole("list", { name: "Inspector örnekleri" });
  await expect(examplesList.locator(":scope > li")).toHaveCount(5);
  // No personal-library hit for "evidence". The shared pool returns missing,
  // then the licensed dictionary fallback gives a Turkish meaning on click.
  const unknownWord = examplesList
    .getByRole("listitem")
    .first()
    .getByTestId("sentence-word")
    .filter({ hasText: "evidence" })
    .first();
  await unknownWord.click();
  await expect(page.getByRole("tooltip")).toContainText("kanıt");
  expect(seen.filter((x) => x.path === "/api/dictionary/turkish" && x.authenticated)).toHaveLength(
    1,
  );
  expect(seen.filter((x) => x.path === "/api/words/import")).toHaveLength(0);
  // The model is called only after the user explicitly asks for draft sentences.
  expect(seen.filter((x) => x.path === "/api/lexicon/examples/draft")).toHaveLength(0);
  await page.getByRole("button", { name: "5 cümle oluştur" }).click();
  const generated = page.getByRole("list", { name: "Oluşturulan beş örnek" }).getByRole("listitem");
  await expect(generated).toHaveCount(5);
  for (const [index, label] of ["Kolay", "Kolay", "Orta", "YDS", "YDS"].entries()) {
    await expect(generated.nth(index)).toContainText(label);
    await expect(generated.nth(index)).toContainText("elde eder");
  }
  expect(
    seen.filter((x) => x.path === "/api/lexicon/examples/draft" && x.authenticated),
  ).toHaveLength(1);
  expect(seen.filter((x) => x.path === "/api/words/import")).toHaveLength(0);
});

test("active saved game denies Inspector without deleting progress or contacting Lexicon", async ({
  page,
}) => {
  const savedGame = {
    version: 3,
    groupMatching: true,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    words: [
      {
        id: wordId,
        word: "Evidence",
        meanings: ["Kanıt"],
        alternatives: [],
        usageNote: "",
        partOfSpeech: "Noun",
        cefr: "B1",
        score: 0,
        examples: [],
        pronunciationUk: "",
        pronunciationUs: "",
        sourceUrl: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    batchSize: 5,
    groupIndex: 0,
    phase: "matching",
    queue: [wordId],
    stageCompleted: 0,
    attempts: {},
    scoreChanges: {},
    assessment: {},
    matching: {
      left: [wordId],
      right: [wordId],
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
  const seen = await mockInspectorCloud(page, { snapshot: savedGame, revision: 1 });
  await page.goto("/");
  await login(page);
  // An active game must survive account restore and Inspector navigation intact.
  // Compare parsed values: JSON property insertion order is not part of game state.
  const gameStorageKey = `yds-atlas-learning-session-v2:${owner}`;
  const readPersistedGame = () =>
    page.evaluate((key) => {
      const stored = localStorage.getItem(key);
      return stored === null ? null : JSON.parse(stored);
    }, gameStorageKey);
  await expect.poll(readPersistedGame).not.toBeNull();
  await expect.poll(readPersistedGame).toEqual(savedGame);
  await page.goto("/#inspector");
  await expect(page.getByRole("alert")).toContainText(
    "Devam eden oyunun sırasında Word Inspector kapalı",
  );
  const gameAfterInspector = await readPersistedGame();
  expect(gameAfterInspector).not.toBeNull();
  expect(gameAfterInspector).toEqual(savedGame);
  expect(seen.filter((x) => x.path === "/api/lexicon/inspect")).toHaveLength(0);
  expect(seen.filter((x) => x.path === "/api/words/import")).toHaveLength(0);
});

test("Turkish Wiktionary fallback is accepted by the client and attributed correctly", async ({
  page,
}) => {
  const seen = await mockInspectorCloud(page, null, "Wiktapi / Turkish Wiktionary");
  await page.goto("/#inspector");
  await login(page);
  await page.getByRole("searchbox", { name: "İngilizce kelime veya ifade" }).fill("obtain");
  await page.getByRole("button", { name: "Havuzda incele" }).click();
  await page.getByRole("button", { name: /Verb.*elde etmek/ }).click();
  const word = page
    .getByRole("list", { name: "Inspector örnekleri" })
    .getByRole("listitem")
    .first()
    .getByTestId("sentence-word")
    .filter({ hasText: "evidence" })
    .first();
  await word.click();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("kanıt");
  await expect(tooltip.getByRole("link", { name: "Wiktapi" })).toHaveAttribute(
    "href",
    "https://api.wiktapi.dev",
  );
  expect(seen.filter((x) => x.path === "/api/dictionary/turkish" && x.authenticated)).toHaveLength(
    1,
  );
  expect(seen.filter((x) => x.path === "/api/words/import")).toHaveLength(0);
});

test("a library word with no Turkish meanings still looks up the licensed dictionary", async ({
  page,
}) => {
  const timestamp = new Date().toISOString();
  const emptyGlossWord = {
    id: wordId,
    word: "evidence",
    meanings: [],
    alternatives: [],
    usageNote: "",
    partOfSpeech: "Noun",
    cefr: "B1",
    score: 0,
    examples: [],
    pronunciationUk: "",
    pronunciationUs: "",
    sourceUrl: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const seen = await mockInspectorCloud(page, null, "Wiktapi / Turkish Wiktionary", [
    emptyGlossWord,
  ]);
  await page.goto("/#inspector");
  await login(page);
  await page.getByRole("searchbox", { name: "İngilizce kelime veya ifade" }).fill("obtain");
  await page.getByRole("button", { name: "Havuzda incele" }).click();
  await page.getByRole("button", { name: /Verb.*elde etmek/ }).click();
  const word = page
    .getByRole("list", { name: "Inspector örnekleri" })
    .getByRole("listitem")
    .first()
    .getByTestId("sentence-word")
    .filter({ hasText: "evidence" })
    .first();
  await word.click();
  await expect(page.getByRole("tooltip")).toContainText("kanıt");
  expect(seen.filter((x) => x.path === "/api/dictionary/turkish" && x.authenticated)).toHaveLength(
    1,
  );
  expect(seen.filter((x) => x.path === "/api/words/import")).toHaveLength(0);
});
