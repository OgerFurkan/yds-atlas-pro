import { expect, test } from "@playwright/test";
import { alice, login, mockCloud } from "../helpers/mock-cloud-account";

test.skip(
  process.env.VITE_FEEDBACK_INSPECTOR_UI_ENABLED !== "true" ||
    process.env.VITE_FEEDBACK_ADMIN_UI_ENABLED !== "true",
  "Requires the local Feedback UI preview with mocked Auth and API.",
);

const choice = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  word: "approach",
  partOfSpeech: "Verb",
  meaning: "yaklaşmak",
  revision: 1,
  status: "machine_validated",
};
const examples = [
  ["easy", "We approach the lake.", "Göle yaklaşıyoruz.", "yaklaşıyoruz"],
  ["easy", "They approach the gate.", "Kapıya yaklaşıyorlar.", "yaklaşıyorlar"],
  ["medium", "We approach the issue with care.", "Konuya özenle yaklaşıyoruz.", "yaklaşıyoruz"],
  [
    "yds",
    "Researchers approach the question from a historical perspective to explain the differences between regions.",
    "Araştırmacılar bölgeler arasındaki farklılıkları açıklamak için soruya tarihsel bir bakış açısıyla yaklaşıyorlar.",
    "yaklaşıyorlar",
  ],
  [
    "yds",
    "The authors approach the problem through comparative analysis because the available evidence varies across countries.",
    "Eldeki kanıtlar ülkeden ülkeye değiştiği için yazarlar soruna karşılaştırmalı analiz yoluyla yaklaşıyorlar.",
    "yaklaşıyorlar",
  ],
].map(([difficulty, sentence, translation, focus]) => ({
  difficulty,
  sentence,
  translation,
  translationFocus: [focus],
}));

test("Feedback Inspector chooses the sense, attributes dictionary candidates and saves only on request", async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  let imports = 0;
  await page.route("**/api/lexicon/inspect?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const word = query.get("word");
    if (word !== choice.word) return route.fulfill({ json: { status: "missing", word } });
    if (!query.has("meaning"))
      return route.fulfill({
        json: {
          status: "choices",
          word,
          choices: [
            choice,
            {
              ...choice,
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              partOfSpeech: "Noun",
              meaning: "yaklaşım",
            },
          ],
        },
      });
    expect(query.get("partOfSpeech")).toBe(choice.partOfSpeech);
    expect(query.get("meaning")).toBe(choice.meaning);
    return route.fulfill({
      json: {
        status: "ready",
        word,
        entry: {
          ...choice,
          senseKey: "approach-verb",
          meanings: [choice.meaning],
          alternatives: [],
          usageNote: "",
          cefr: "B2",
          examples,
          pronunciationUk: null,
          pronunciationUs: null,
        },
      },
    });
  });
  await page.route("**/api/dictionary/turkish?word=lake", (route) =>
    route.fulfill({
      json: {
        status: "ready",
        word: "lake",
        entries: [{ partOfSpeech: "noun", meanings: ["göl"] }],
        source: {
          provider: "FreeDictionaryAPI.com / Wiktionary",
          url: "https://en.wiktionary.org/wiki/lake",
          license: "CC BY-SA 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        },
      },
    }),
  );
  await page.route("**/api/words/import", (route) => {
    const input = route.request().postDataJSON()[0];
    expect(input.lexicon.entryId).toBe(choice.id);
    expect(input.usageNote).toBe("");
    const owner = JSON.parse(
      Buffer.from(route.request().headers().authorization.split(".")[1], "base64url").toString(),
    ).sub;
    expect(owner).toBe(alice);
    imports++;
    const duplicate = cloud.libraries[owner].some((row) => row.word === input.word);
    if (!duplicate)
      cloud.libraries[owner].push({
        ...input,
        id: choice.id,
        createdAt: "2026-11-19T00:00:00Z",
        updatedAt: "2026-11-19T00:00:00Z",
      });
    return route.fulfill({ json: { added: duplicate ? 0 : 1, duplicates: duplicate ? 1 : 0 } });
  });
  await page.goto("/");
  await login(page);
  await page.goto("/#inspector");
  const input = page.getByRole("searchbox");
  await input.fill("unknown");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Henüz havuzda bulunmuyor" })).toBeFocused();
  await input.fill("approach");
  await input.press("Enter");
  await page.getByRole("button", { name: /Verb yaklaşmak/i }).click();
  await expect(page.getByRole("heading", { name: "approach", exact: true })).toBeFocused();
  await expect(page.getByText("2 kolay · 1 orta · 2 YDS")).toBeVisible();
  await page.locator('[data-word="lake"]').click();
  const popup = page.getByRole("tooltip");
  await expect(popup).toContainText("göl");
  await expect(popup).toContainText("bağlamı doğrulanmadı");
  await expect(popup.getByRole("link", { name: "Wiktionary" })).toHaveAttribute(
    "href",
    "https://en.wiktionary.org/wiki/lake",
  );
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  expect(imports).toBe(0);
  await page.getByRole("button", { name: "Kütüphaneye ekle" }).click();
  await expect(page.getByText("Kelime kütüphanene eklendi.")).toBeVisible();
  expect(imports).toBe(1);
  await page.getByRole("button", { name: "Kütüphaneye ekle" }).click();
  await expect(page.getByText(/Kelime zaten kütüphanende/)).toBeVisible();
  await page.reload();
  await page.goto("/#library");
  await expect(page.getByRole("button", { name: /approach kelime ayrıntıları/i })).toBeVisible();
});

test("Feedback editorial decisions require confirmation and a second account cannot see the prior queue", async ({
  page,
}) => {
  await mockCloud(page);
  const summary = {
    ...choice,
    senseKey: "approach-verb",
    meanings: [choice.meaning],
    cefr: "B2",
    digest: "fixture-digest",
    updatedAt: "2026-11-19T00:00:00Z",
  };
  const decisions: string[] = [];
  let listReads = 0;
  await page.route("**/api/admin/**", (route) => {
    const request = route.request();
    const payload = request.headers().authorization.split(".")[1];
    const admin = JSON.parse(Buffer.from(payload, "base64url").toString()).sub === alice;
    if (!admin) return route.fulfill({ status: 403, json: { code: "FORBIDDEN" } });
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { admin: true } });
    if (path.endsWith("/lexicon")) {
      listReads++;
      return route.fulfill({
        json: { entries: [summary], offset: 0, limit: 20, hasMore: false, nextOffset: null },
      });
    }
    if (path.endsWith("/review")) {
      const body = request.postDataJSON();
      expect(body.expectedRevision).toBe(summary.revision);
      decisions.push(body.nextStatus);
      summary.revision++;
      summary.status = body.nextStatus;
      return route.fulfill({
        json: {
          entry: summary,
          action: body.nextStatus === "human_reviewed" ? "approved" : "quarantined",
        },
      });
    }
    return route.fulfill({
      json: {
        entry: {
          ...summary,
          content: { examples },
          provenance: {
            provider: "fixture",
            model: null,
            validation: null,
          },
        },
        revisions: [],
        hasOlderRevisions: false,
      },
    });
  });
  await page.goto("/");
  await login(page);
  await page.goto("/#admin");
  await page.getByRole("button", { name: /approach/i }).click();
  await page.getByRole("button", { name: "Onayla", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Kararı uygula" });
  await expect(confirm).toBeFocused();
  expect(decisions).toEqual([]);
  await confirm.click();
  await expect(page.getByText("Kelime editoryal olarak onaylandı.")).toBeVisible();
  await page.getByRole("button", { name: "Karantinaya al" }).click();
  await confirm.click();
  await expect(page.getByText("Kelime karantinaya alındı.")).toBeVisible();
  expect(decisions).toEqual(["human_reviewed", "quarantined"]);
  await page.getByRole("button", { name: "Hesabım", exact: true }).click();
  await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();
  const readsBeforeLogin = listReads;
  await login(page, "bob@example.com");
  await page.goto("/#admin");
  await expect(page.getByText(/yetkili hesapla giriş yapmalısın/)).toBeVisible();
  await expect(page.getByRole("button", { name: /approach/i })).toHaveCount(0);
  expect(listReads).toBe(readsBeforeLogin);
});
