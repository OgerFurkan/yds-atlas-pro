import { expect, type Page } from "@playwright/test";
import type { GameSession } from "@yds-atlas/shared";

export const alice = "11111111-1111-4111-8111-111111111111";
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
export async function mockCloud(page: Page, waitForSessionSave?: Promise<void>) {
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
    if (path === "/api/lexicon/resolve") {
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
          difficulty: index < 2 ? "easy" : index === 2 ? "medium" : "yds",
        })),
      };
      // Mirror the real v4 resolve wire format: generated versus pool provenance.
      await route.fulfill({
        json: {
          source: "generated",
          entry: {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            wordKey: "resilient",
            partOfSpeech: "Adjective",
            senseKey: "resilient-adjective-durable",
            revision: 1,
            status: "machine_validated",
            content: suggestion,
            provenance: { model: "contract-test" },
          },
        },
      });
      return;
    }
    if (path === "/api/lexicon/complete" || path === "/api/lexicon/suggest") {
      const names = path.endsWith("/complete")
        ? body.words
        : ["Resilient", "Robust", "Notion", "Derive", "Assess"];
      const suggestions = names.map((name: string) => ({
        lexicon: { entryId: crypto.randomUUID(), revision: 1, contractVersion: 1 },
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
          difficulty: index < 2 ? "easy" : index === 2 ? "medium" : "yds",
        })),
      }));
      await route.fulfill({
        json: {
          suggestions,
          provider: path === "/api/lexicon/suggest" ? "Lexicon" : "Gemini",
          model: path === "/api/lexicon/suggest" ? "atlas-human-reviewed-pool-v1" : "contract-test",
        },
      });
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
    // Never confuse /api/lexicon/complete with completing a learning session.
    if (path.startsWith("/api/learning/sessions/") && path.endsWith("/complete")) {
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

export async function login(page: Page, email = "alice@example.com") {
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page).toHaveURL(/#login$/);
  const form = page.getByRole("form", { name: "Hesap giriş formu" });
  await form.getByLabel("E-posta adresi").fill(email);
  await form.getByLabel("Şifre", { exact: true }).fill("test-password");
  await form.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hesabım", exact: true })).toBeVisible();
}
