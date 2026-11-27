import { mockOrigin } from "../../../frontend/config/playwright/loopback";
import type { Page } from "../../../frontend/config/playwright/test-fixtures";
import {
  type GameSession,
  type WordEntry,
  wordEntrySchema,
} from "../../../packages/shared/src/index";
import { fixtureSource, incompleteDayWords, readyDayWords } from "./day-study-words";

export const demoOrigin = mockOrigin;
const owner = "f17e0000-0000-4000-8000-000000000999";
const readyByName = new Map(readyDayWords.map((word) => [word.word.toLowerCase(), word]));

function suggestion(word: WordEntry) {
  return {
    word: word.word,
    alternatives: word.alternatives,
    meanings: word.meanings,
    usageNote: word.usageNote,
    partOfSpeech: word.partOfSpeech,
    cefr: word.cefr,
    examples: word.examples.map(({ sentence, translation, difficulty, translationFocus }) => ({
      sentence,
      translation,
      difficulty,
      translationFocus: translationFocus ?? [],
    })),
  };
}

export const healthyGemini = {
  status: "ok",
  databaseConfigured: true,
  aiConfigured: true,
  ai: {
    configured: true,
    keyCount: 1,
    quotaConfigured: true,
    modelWord: fixtureSource,
    modelChat: fixtureSource,
    word: { readyKeys: 1, waitSeconds: null },
    chat: { readyKeys: 1, waitSeconds: null },
  },
} as const;

export async function installDayStudyMock(
  page: Page,
  options: {
    words: readonly WordEntry[];
    health?: () => number | Promise<number>;
    lookup?: string;
    complete?: (call: number) => number | Promise<number>;
    importStatus?: () => number;
  },
) {
  const context = page.context();
  const words = structuredClone([...options.words]);
  const requests = {
    health: 0,
    complete: [] as string[][],
    saved: [] as string[],
    imports: 0,
    importCommands: [] as string[],
    deletes: 0,
  };
  let nextWord = 200;
  const group = { day: 1, words: words.map((word) => word.id) };
  const plan = { owner, revision: 1, plan: { size: 20, groups: [group], exclusions: [] } };
  let session: { snapshot: GameSession; revision: number } | null = null;
  const accessToken = [
    btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })),
    "atlas-local-fixture",
  ].join(".");

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== demoOrigin) return route.abort();
    const path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/health") {
      ++requests.health;
      const status = (await options.health?.()) ?? 200;
      return route.fulfill({
        status,
        json: status === 200 ? healthyGemini : { error: "Sentetik bağlantı hatası" },
      });
    }
    if (request.headers().authorization !== `Bearer ${accessToken}`)
      return route.fulfill({ status: 401, json: { error: "Test oturumu gerekli." } });
    if (path === "/api/account")
      return route.fulfill({
        json: {
          planProtocol: options.importStatus ? 1 : undefined,
          dailyGoal: 20,
          session,
          progress: [],
          completedDays: [],
        },
      });
    if (path === "/api/account/plan" && request.method() === "GET" && options.importStatus)
      return route.fulfill({ json: plan });
    if (path === "/api/words") return route.fulfill({ json: words });
    if (
      path === "/api/account/plan/import" &&
      request.method() === "POST" &&
      options.importStatus
    ) {
      ++requests.imports;
      const command = request.postDataJSON();
      requests.importCommands.push(command.command);
      if (
        command.day !== group.day ||
        command.owner !== owner ||
        command.revision !== plan.revision
      )
        return route.fulfill({
          status: 409,
          json: { code: "PLAN_CONFLICT", error: "Plan değişti." },
        });
      const status = options.importStatus();
      if (status !== 200)
        return route.fulfill({ status, json: { error: "Sentetik kayıt hatası" } });
      const incoming = command.words as WordEntry[];
      let added = 0;
      for (const input of incoming) {
        if (words.some((word) => word.word.toLowerCase() === input.word.toLowerCase())) continue;
        const now = new Date().toISOString();
        const id = `f17e0000-0000-4000-8000-${String(++nextWord).padStart(12, "0")}`;
        words.push(wordEntrySchema.parse({ ...input, id, createdAt: now, updatedAt: now }));
        group.words.push(id);
        added++;
      }
      plan.revision++;
      return route.fulfill({ json: { ...plan, added, duplicates: incoming.length - added } });
    }
    if (request.method() === "DELETE") {
      ++requests.deletes;
      return route.fulfill({ status: 405, json: { error: "Bu işlem demo kapsamında değil." } });
    }
    if (path === "/api/lexicon/inspect") {
      const name = url.searchParams.get("word") ?? "";
      const match = name === options.lookup ? readyByName.get(name) : undefined;
      return route.fulfill({
        json: match
          ? {
              status: "ready",
              word: name,
              entry: {
                ...suggestion(match),
                word: name,
                id: match.id,
                revision: 1,
                status: "human_reviewed",
                senseKey: "fixture",
                meaning: match.meanings[0],
                pronunciationUk: null,
                pronunciationUs: null,
              },
            }
          : { status: "missing", word: name },
      });
    }
    if (path === "/api/ai/words/complete") {
      const names: string[] = request.postDataJSON().words;
      requests.complete.push(names);
      const status = (await options.complete?.(requests.complete.length)) ?? 200;
      const suggestions = names.flatMap((name) => {
        const match = readyByName.get(name.toLowerCase());
        return match ? [suggestion(match)] : [];
      });
      await route
        .fulfill({
          status,
          json:
            status === 200
              ? { provider: "Gemini", model: `${fixtureSource} (sağlayıcı taklidi)`, suggestions }
              : { error: `Sentetik Gemini hatası (HTTP ${status}).` },
        })
        .catch(() => {});
      return;
    }
    if (path.startsWith("/api/words/") && request.method() === "PUT") {
      const index = words.findIndex((word) => word.id === path.slice("/api/words/".length));
      if (
        index === -1 ||
        words[index].updatedAt !== request.headers()["x-atlas-expected-updated-at"]
      )
        return route.fulfill({ status: 409, json: { error: "Test kelimesi değişti." } });
      words[index] = wordEntrySchema.parse({
        ...words[index],
        ...request.postDataJSON(),
        updatedAt: new Date(Date.parse(words[index].updatedAt) + 1).toISOString(),
      });
      requests.saved.push(words[index].id);
      return route.fulfill({ json: words[index] });
    }
    if (path === "/api/learning/session" && request.method() === "PUT") {
      const { snapshot, revision } = request.postDataJSON();
      session = { snapshot, revision: revision + 1 };
      return route.fulfill({ json: { revision: session.revision } });
    }
    return route.fulfill({ status: 404, json: { error: "Bu işlem demo kapsamında değil." } });
  });
  await page.addInitScript(
    ({ origin, userId, token, label }) => {
      if (location.origin !== origin || sessionStorage.getItem("atlas:fixture-initialized")) return;
      sessionStorage.setItem("atlas:fixture-initialized", "1");
      sessionStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "atlas-local-fixture",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: userId,
            role: "authenticated",
            aud: "authenticated",
            email: "day-study@example.invalid",
            user_metadata: { display_name: label },
          },
        }),
      );
    },
    { origin: demoOrigin, userId: owner, token: accessToken, label: fixtureSource },
  );

  return { words, requests, getSession: () => session?.snapshot };
}

export { incompleteDayWords, readyDayWords };
