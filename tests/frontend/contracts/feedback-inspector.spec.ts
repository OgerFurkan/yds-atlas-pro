import { mockOrigin } from "../../../frontend/config/playwright/loopback";
import { expect, type Page, test } from "../../../frontend/config/playwright/test-fixtures";

import { readyDayWords } from "../fixtures/day-study-words";

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
const credit = {
  license: "CC BY-SA 4.0",
  source: "https://example.org/fixture/obtain",
  author: "Atlas fixture contributor",
};
const entry = {
  ...choice,
  attribution: credit,
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
  missing = false,
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
  await page.route(mockOrigin + "/api/**", async (route) => {
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
          word === "mitigate"
            ? {
                status: "ready",
                word,
                entry: {
                  ...entry,
                  word,
                  meaning: "azaltmak",
                  meanings: ["azaltmak", "hafifletmek"],
                  examples: examples.map((ex, i) => ({
                    ...ex,
                    sentence: [
                      "Trees can mitigate heat.",
                      "Rest helps mitigate pain.",
                      "New safeguards mitigate the risk of flooding.",
                      "These measures can mitigate the effects of climate change.",
                      "Early intervention can mitigate the long-term impact of water scarcity.",
                    ][i],
                    translation: [
                      "Ağaçlar sıcaklığı azaltabilir.",
                      "Dinlenmek ağrıyı hafifletmeye yardımcı olur.",
                      "Yeni önlemler sel riskini azaltır.",
                      "Bu önlemler iklim değişikliğinin etkilerini azaltabilir.",
                      "Erken müdahale su kıtlığının uzun vadeli etkisini azaltabilir.",
                    ][i],
                    translationFocus: [
                      ["azaltabilir", "hafifletmeye", "azaltır", "azaltabilir", "azaltabilir"][i],
                    ],
                  })),
                },
              }
            : word === "evidence"
              ? { status: "missing", word: "evidence" }
              : sense === "elde etmek"
                ? { status: "ready", word: "obtain", entry }
                : {
                    status: "choices",
                    word: "obtain",
                    choices: [
                      choice,
                      {
                        ...choice,
                        id: "33333333-3333-4333-8333-333333333333",
                        meaning: "sağlamak",
                      },
                    ],
                  },
      });
    } else if (url.pathname === "/api/lexicon/preview") {
      expect(request.method()).toBe("GET");
      const rows = [
        ["evidence", "Noun", "kanıt"],
        ["mitigate", "Verb", "azaltmak, hafifletmek"],
        ["measure", "Noun", "önlem"],
      ];
      await route.fulfill({
        json: missing
          ? []
          : rows.map(([word, partOfSpeech, meaning], index) => ({
              id: [entryId, wordId, owner][index],
              word,
              partOfSpeech,
              meanings: [meaning],
              revision: 2,
              senseKey: "a".repeat(64),
              ipaUk: word === "mitigate" ? "/ˈmɪtɪɡeɪt/" : word === "measure" ? "/ˈmeʒə/" : null,
              ipaUs: null,
              audioUk: null,
              audioUs: null,
              attribution: null,
            })),
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
  await expect(page.getByRole("heading", { name: "Beş kademeli örnek" })).toBeVisible();
  expect(seen.filter((x) => x.path === "/api/lexicon/inspect" && x.authenticated)).toHaveLength(2);
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
  expect(input).toMatchObject({ attribution: credit });
  await expect(page.getByRole("link", { name: credit.author })).toHaveAttribute(
    "href",
    credit.source,
  );
  expect(input.score).toBe(0);
  expect(input.examples).toHaveLength(5);
  expect(seen.filter((x) => /\/api\/ai\//.test(x.path))).toHaveLength(0);
});

test("sentence tap reads a canonical meaning, and five translations are opt-in", async ({
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
  await expect(page.getByRole("dialog", { name: "Kelime bilgisi" })).toContainText("kanıt");
  expect(seen.filter((x) => x.path === "/api/lexicon/preview" && x.authenticated)).toHaveLength(1);
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
  await expect(page.locator(".atlas-chat-launcher")).toHaveCount(0);
  const gameAfterInspector = await readPersistedGame();
  expect(gameAfterInspector).not.toBeNull();
  expect(gameAfterInspector).toEqual(savedGame);
  expect(seen.filter((x) => x.path === "/api/lexicon/inspect")).toHaveLength(0);
  expect(seen.filter((x) => x.path === "/api/words/import")).toHaveLength(0);
});

test("an absent canonical sense stays missing without an external call", async ({ page }) => {
  const seen = await mockInspectorCloud(page, null, true);
  await page.goto("/#inspector");
  await login(page);
  await page.getByRole("searchbox").fill("mitigate");
  await page.getByRole("button", { name: "Havuzda incele" }).click();
  await page.locator('[data-word="these"]').click();
  await expect(page.getByRole("dialog", { name: "Kelime bilgisi" })).toContainText(
    "Ortak sözlükte karşılık bulunamadı.",
  );
  expect(
    seen.filter(
      (r) => r.path.includes("dictionary") || (r.method === "POST" && r.path.includes("lexicon")),
    ),
  ).toHaveLength(0);
});

test("an incomplete private word uses the canonical preview", async ({ page }) => {
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
  const seen = await mockInspectorCloud(page, null, false, [emptyGlossWord]);
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
  await expect(page.getByRole("dialog", { name: "Kelime bilgisi" })).toContainText("kanıt");
  expect(seen.filter((x) => x.path === "/api/lexicon/preview" && x.authenticated)).toHaveLength(1);
  expect(seen.filter((x) => x.path === "/api/words/import")).toHaveLength(0);
});

for (const theme of ["light", "dark"]) {
  test("example sentence and compact canonical tooltip " + theme, async ({ page }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem("yds-atlas-theme", theme), theme);
    await page.addInitScript(() => {
      const signals: string[] = [];
      Object.defineProperty(window, "speechSynthesis", {
        value: {
          getVoices: () => [{ lang: "en-GB" }, { lang: "en-US" }],
          cancel: () => {},
          speak: (u: {
            text: string;
            lang: string;
            voice: { lang: string };
            onend: () => void;
          }) => {
            signals.push(u.text + "|" + u.lang + "|" + u.voice.lang);
            document.documentElement.dataset.testVoice = signals.join(",");
            queueMicrotask(() => u.onend());
          },
        },
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: class {
          constructor(public text: string) {}
        },
      });
    });
    const seen = await mockInspectorCloud(page);
    await page.goto("/#inspector");
    await login(page);
    await page.getByRole("searchbox").fill("mitigate");
    await page.getByRole("button", { name: "Havuzda incele" }).click();
    const row = page
      .getByRole("list", { name: "Inspector örnekleri" })
      .locator(":scope > li")
      .nth(3);
    await expect(row).toContainText("EXAMPLE SENTENCE");
    await expect(row).toContainText("4 / 5 · YDS");
    await expect(row.getByTestId("sentence-word")).toHaveCount(9);
    const main = row.locator('[data-word="mitigate"]'),
      other = row.locator('[data-word="measures"]');
    await main.scrollIntoViewIfNeeded();
    const select = async (el: typeof main) =>
      testInfo.project.use.hasTouch ? el.tap() : el.click();
    await select(main);
    const tip = page.getByRole("dialog", { name: "Kelime bilgisi" });
    await expect(tip).toContainText("azaltmak");
    await expect(tip.getByRole("button", { name: /UK telaffuzunu/ })).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-test-voice", /.+/);
    await tip.getByRole("button", { name: /UK telaffuzunu/ }).click();
    await tip.getByRole("button", { name: /US telaffuzunu/ }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-test-voice",
      "mitigate|en-GB|en-GB,mitigate|en-US|en-US",
    );
    const blue = theme === "light" ? "rgb(29, 78, 216)" : "rgb(124, 181, 255)",
      orange = theme === "light" ? "rgb(154, 52, 18)" : "rgb(255, 186, 112)";
    await expect(main).toHaveCSS("color", orange);
    await expect(tip).toContainText("/ˈmɪtɪɡeɪt/");
    await expect(tip.locator("strong").first()).toHaveCSS("color", orange);
    await expect(tip).not.toContainText("Kök biçimi");
    await page.screenshot({
      path: testInfo.outputPath("main-" + theme + ".png"),
      animations: "disabled",
    });
    await select(other);
    await expect(main).toHaveCSS("color", blue);
    await expect(other).toHaveCSS("color", orange);
    await expect(tip).not.toContainText("/ˈmɪtɪɡeɪt/");
    await expect(tip).not.toContainText("/ˈmeʒə/");
    const card = await tip.innerText();
    const fields = ["measures", "Noun", "British", "American", "önlem", "Kök biçimi"];
    const order = fields.map((field) => card.indexOf(field));
    expect(order.every((v, i) => v >= 0 && (!i || v > order[i - 1]))).toBe(true);
    await tip.getByRole("button", { name: /UK telaffuzunu/ }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-test-voice",
      /measures\|en-GB\|en-GB$/,
    );
    await expect(page.locator(".atlas-chat-launcher")).toBeHidden();
    await expect(tip).toContainText("önlem");
    await expect(tip).toContainText("measure");
    await expect(row).toContainText("4 / 5 · YDS");
    await expect(row).toContainText("Bu önlemler iklim");
    const rect = await tip.boundingBox(),
      view = page.viewportSize()!;
    const tokenRect = await other.boundingBox();
    const header = await page.locator("header.sticky").boundingBox();
    expect(rect!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(view.height);
    expect(
      rect!.y >= tokenRect!.y + tokenRect!.height || rect!.y + rect!.height <= tokenRect!.y,
    ).toBe(true);
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(view.width);
    expect(seen.filter((r) => r.path === "/api/lexicon/preview")).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath(theme + ".png"), animations: "disabled" });
    if (testInfo.project.name === "tablet") {
      await page.setViewportSize({ width: view.height, height: view.width });
      await expect(other).toHaveCSS("color", orange);
      const rotated = await tip.boundingBox();
      expect(rotated!.x).toBeGreaterThanOrEqual(0);
      expect(rotated!.x + rotated!.width).toBeLessThanOrEqual(view.height);
      await page.setViewportSize(view);
    }
    if (testInfo.project.name === "mobile") {
      await page.setViewportSize({ width: 390, height: 320 });
      await other.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 158));
      await expect(tip).toHaveAttribute("data-layout", "sheet");
      const sheet = await tip.boundingBox();
      const selected = await other.boundingBox();
      expect(sheet!.y).toBeGreaterThanOrEqual(selected!.y + selected!.height);
      expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(320);
      await page.setViewportSize(view);
      await other.scrollIntoViewIfNeeded();
    }
    await tip.getByRole("button", { name: "Kapat" }).focus();
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCount(0);
    await expect(main).toHaveCSS("color", blue);
    await expect(other).toBeFocused();
    if (testInfo.project.name === "desktop") {
      await main.hover();
      await expect(tip).toContainText("azaltmak");
      await tip.hover();
      await expect(tip).toBeVisible();
      await main.focus();
      await page.keyboard.press("ArrowDown");
      await expect(tip.getByRole("button", { name: "Kapat" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(main).toBeFocused();
    }
  });
}

test("control center routes owner content through draft, explicit publication and revision history", async ({
  page,
  browser,
}, info) => {
  await mockInspectorCloud(page);
  let writes = 0;
  let generation = 0;
  const content = {
    word: "obtain",
    partOfSpeech: "Verb",
    cefr: "B1",
    alternatives: [],
    meanings: ["elde etmek"],
    usageNote: "Geçişli fiil.",
    examples,
  };
  await page.route("**/api/control**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (!r.request().headers().authorization?.startsWith("Bearer "))
      return r.fulfill({ status: 403, json: {} });
    if (path === "/api/control/draft") {
      generation++;
      if (generation === 2)
        return r.fulfill({
          status: 503,
          json: { code: "AI_UNAVAILABLE", error: "Sentetik kesinti" },
        });
      return r.fulfill({
        json: {
          content: { ...content, word: r.request().postDataJSON().word },
          provenance: { source: "ai-reviewed", license: "Atlas Original" },
        },
      });
    }
    if (path === "/api/control/revisions") {
      const cmd = r.request().postDataJSON();
      expect(cmd.items).toHaveLength(2);
      expect(cmd.items[0].content.meanings).toEqual(["edinmek"]);
      content.meanings = cmd.items[0].content.meanings;
      writes++;
      return r.fulfill({ json: [{ id: entryId, revision: 1 }] });
    }
    if (path === "/api/control/entries")
      return r.fulfill({
        json: [
          {
            id: entryId,
            revision: 1,
            status: "human_reviewed",
            content,
            provenance: { license: "Atlas Original", source: "editor" },
          },
        ],
      });
    if (path === "/api/control/history")
      return r.fulfill({
        json: [
          {
            revision: 1,
            status: "human_reviewed",
            created_at: "2026-01-01",
            content,
            provenance: { license: "Atlas Original", source: "editor" },
          },
        ],
      });
    return r.fulfill({ json: { authorized: true } });
  });
  await page.goto("/");
  await login(page);
  await page.goto("/#control-center");
  await expect(page.getByRole("heading", { name: "Atlas Control Center" })).toBeVisible();
  await page.getByLabel(/AI ile hazırlanacak kelimeler/).fill("obtain\nacquire");
  await page.getByRole("button", { name: "AI taslaklarını hazırla" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("group", { name: "obtain", exact: true })).toBeVisible();
  await expect(page.getByLabel(/AI ile hazırlanacak kelimeler/)).toHaveValue("acquire");
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "AI taslaklarını hazırla" }).click();
  await expect(page.getByRole("group", { name: "acquire", exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await page
    .getByRole("group", { name: "obtain", exact: true })
    .getByLabel(/Türkçe anlamlar/)
    .fill("edinmek");
  await page.screenshot({ path: info.outputPath("cc-draft.png"), animations: "disabled" });
  const reader = await browser.newContext({ serviceWorkers: "block" });
  try {
    const otherPage = await reader.newPage();
    await mockInspectorCloud(otherPage);
    await otherPage.clock.install();
    await otherPage.route("**/api/lexicon/preview?**", (route) =>
      route.fulfill({
        json: [
          {
            id: entryId,
            word: "obtain",
            partOfSpeech: "Verb",
            senseKey: "a".repeat(64),
            revision: writes + 1,
            meanings: content.meanings,
            ipaUk: null,
            ipaUs: null,
            audioUk: null,
            audioUs: null,
            attribution: null,
          },
        ],
      }),
    );
    await otherPage.goto(mockOrigin + "/#inspector");
    await login(otherPage);
    await otherPage.getByRole("searchbox").fill("obtain");
    await otherPage.getByRole("button", { name: "Havuzda incele" }).click();
    await otherPage.getByRole("button", { name: /Verb.*elde etmek/ }).click();
    await otherPage.locator('[data-word="obtain"]').first().focus();
    const readerTip = otherPage.getByRole("dialog", { name: "Kelime bilgisi" });
    await expect(readerTip).toContainText("elde etmek");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "İncele ve yayınla" }).click();
    await expect(page.getByRole("status")).toContainText("Revizyon kaydedildi");
    await otherPage.clock.fastForward(60_100);
    await expect(readerTip).toContainText("edinmek");
    await otherPage.route("**/api/lexicon/preview?**", (route) =>
      route.fulfill({
        json: ["edinmek", "sağlamak"].map((meaning, i) => ({
          id: i ? wordId : entryId,
          word: "obtain",
          partOfSpeech: "Verb",
          senseKey: (i ? "b" : "a").repeat(64),
          revision: 3,
          meanings: [meaning],
          ipaUk: null,
          ipaUs: null,
          audioUk: null,
          audioUs: null,
          attribution: null,
        })),
      }),
    );
    const sibling = await reader.newPage();
    // A same-origin publisher exercises the real BroadcastChannel without starting
    // a second, unmocked Auth client against this reader's synthetic session.
    const signalPage = mockOrigin + "/revision-signal";
    await sibling.route(signalPage, (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Revision signal</title>" }),
    );
    await sibling.goto(signalPage);
    await otherPage.bringToFront();
    await sibling.evaluate(() => {
      const c = new BroadcastChannel("atlas-lexicon-revisions");
      c.postMessage("published");
      c.close();
    });
    await expect(readerTip).toContainText("birden fazla anlam");
    await expect(readerTip).toContainText("sağlamak");
  } finally {
    await reader.close();
  }
  expect(generation).toBe(3);
  expect(writes).toBe(1);
  await page.getByLabel("İngilizce kelime", { exact: true }).fill("obtain");
  await page.getByRole("button", { name: "Ara", exact: true }).click();
  await page.getByRole("button", { name: /obtain · Verb/ }).click();
  await expect(page.getByText(/v1 · human_reviewed/).last()).toBeVisible();
  const version = page.locator("summary").filter({ hasText: "v1 · human_reviewed" });
  await version.click();
  await version.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: info.outputPath("cc-history.png"), animations: "disabled" });
});

test("guest revealed sentence stays local and cannot read privileged content", async ({ page }) => {
  const seen = await mockInspectorCloud(page);
  await page.addInitScript(
    (words) => localStorage.setItem("yds-atlas-words-v1", JSON.stringify(words)),
    readyDayWords,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Hedefe Başla" }).click();
  await page.getByRole("button", { name: "Günlük göreve başla", exact: true }).click();
  await expect(page.getByTestId("sentence-word-definition")).toHaveCount(0);
  await page.getByRole("button", { name: "Kartı çevir ve anlamı göster" }).click();
  await page.locator('#word-example [data-testid="sentence-word"]').first().click();
  await expect(page.getByTestId("sentence-word-definition")).toContainText("giriş yap");
  expect(seen.filter((r) => /lexicon|control/.test(r.path))).toEqual([]);
});
