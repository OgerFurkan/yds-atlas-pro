import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { loopbackBrowser } from "../../../frontend/config/playwright/loopback.ts";

const loadBrowser = createRequire(new URL("../../../frontend/package.json", import.meta.url));
let input = "";
for await (const part of process.stdin) input += part;
const { origin, credentials, owner, practice, report } = JSON.parse(input);
const address = new URL(origin);
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d{1,5}\/$/);
assert.ok(Number(address.port) >= 1024);
async function verify() {
  const { chromium } = loadBrowser("@playwright/test");
  const browser = await chromium.launch({ ...loopbackBrowser.launchOptions, timeout: 15000 });
  console.log("LOCAL browser launched");
  try {
    const devices = await Promise.all([
      browser.newContext({ serviceWorkers: "block" }),
      browser.newContext({ serviceWorkers: "block" }),
    ]);
    const pages = await Promise.all(devices.map((d) => d.newPage()));
    for (const p of pages) {
      p.setDefaultTimeout(10000);
      p.setDefaultNavigationTimeout(12000);
      p.on("response", (r) => {
        if (r.status() >= 400)
          console.log("LOCAL browser response", new URL(r.url()).pathname, r.status());
      });
      await p.goto(origin + "#login", { waitUntil: "domcontentloaded" });
      const form = p.getByRole("form", { name: "Hesap giriş formu" });
      await form.getByLabel("E-posta adresi").fill(credentials.email);
      await form.getByLabel("Şifre", { exact: true }).fill(credentials.password);
      const remember = form.getByRole("checkbox");
      if ((await remember.count()) && !(await remember.first().isChecked()))
        await remember.first().check();
      await form.getByRole("button", { name: "Giriş yap", exact: true }).click();
      await p.getByRole("button", { name: "Hesabım", exact: true }).waitFor();
    }
    const first = pages[0],
      second = pages[1];
    await first.goto(origin + "#library");
    const put = first.waitForResponse(
      (r) => r.url().endsWith("/api/account/plan") && r.request().method() === "PUT",
    );
    await first
      .getByRole("button", {
        name: /Hesap planını başlat|Planı başlat|Plan oluştur|Yeni plan|planı oluştur/i,
      })
      .click({ timeout: 8000 });
    const response = await put;
    assert.equal(response.status(), 200);
    const saved = await response.json();
    assert.equal(saved.owner, owner);
    const read = second.waitForResponse(
      (r) => r.url().endsWith("/api/account/plan") && r.request().method() === "GET",
    );
    await second.goto(origin + "#library");
    assert.deepEqual(await (await read).json(), saved);
    await first.close();
    const reopened = await devices[0].newPage();
    reopened.setDefaultTimeout(10000);
    await reopened.goto(origin + "#library");
    await reopened.getByRole("button", { name: "Hesabım", exact: true }).waitFor();
    await playAssessment(reopened, second);
  } finally {
    await browser.close();
  }
}

async function playAssessment(page, second) {
  const root = "/api/learning/online";
  const pairs = new Map(practice.map(({ word, meaning }) => [word, meaning]));
  const response = (p, method) =>
    p.waitForResponse(
      (r) => new URL(r.url()).pathname.startsWith(root) && r.request().method() === method,
    );
  await page.goto(origin + "#game");
  await page.getByRole("tab", { name: "Kütüphanem" }).click();
  const opening = response(page, "POST");
  await page.getByRole("button", { name: "Günlük göreve başla", exact: true }).click();
  let view = await (await opening).json();
  assert.equal(view.total, 20);
  const phases = new Set();
  const board = () => page.locator("[data-phase]");
  const byText = (text) => board().getByRole("button", { name: text, exact: true });
  const next = () => byText("Devam et");
  let interruption = false;
  let examplesChecked = false;
  let groupExamplesChecked = false;
  let finalExamplesChecked = false;

  async function fiveExamples() {
    const details = board().getByText("Örnek cümleler (5)", { exact: true });
    await details.click();
    assert.equal(await board().locator("details[open] li").count(), 5);
  }

  for (let step = 0; view.status === "active" && step < 400; step++) {
    phases.add(view.group + "/" + view.phase);
    assert.equal(view.state, undefined);
    assert.equal(view.words, undefined);
    let action;
    if (view.phase === "flashcards") {
      await byText("Kartı çevir ve anlamı göster").click();
      if (!examplesChecked) {
        await fiveExamples();
        examplesChecked = true;
      }
      action = next();
    } else if (view.phase.endsWith("matching")) {
      if (view.next) action = next();
      else {
        const chosen = view.choices.find((entry) => entry.side === "left" && entry.selected);
        const choice = chosen
          ? view.choices.find(
              (entry) => entry.side === "right" && entry.text === pairs.get(chosen.text),
            )
          : view.choices.find((entry) => entry.side === "left" && !entry.matched);
        action = byText(choice.text);
      }
    } else if (view.feedback === undefined) {
      assert.equal(view.lesson, undefined);
      const text = view.phase.endsWith("context")
        ? practice[Number(view.prompt.match(/^Marker (\d+)/)?.[1])].word
        : pairs.get(view.prompt);
      action = byText(text);
    } else {
      if (!groupExamplesChecked && view.phase === "context") {
        await fiveExamples();
        groupExamplesChecked = true;
      }
      if (!finalExamplesChecked && view.phase === "final-context") {
        await fiveExamples();
        finalExamplesChecked = true;
      }
      action = view.confidence ? byText("Kolay hatırladım") : next();
    }

    if (!interruption && view.phase === "matching") {
      interruption = true;
      await page.context().setOffline(true);
      await action.click();
      await page.getByRole("button", { name: "Yeniden doğrula" }).waitFor();
      await page.context().setOffline(false);
      const retry = response(page, "POST");
      await page.getByRole("button", { name: "Yeniden doğrula" }).click();
      view = await (await retry).json();
      const sync = response(second, "GET");
      await second.goto(origin + "#game");
      assert.deepEqual((await (await sync).json()).current, view);
      continue;
    }

    const final = view.phase === "final-context" && view.done === 19 && view.next;
    if (final) {
      const route = "**/api/learning/online/" + view.id;
      let stored;
      await page.route(
        route,
        async (r) => {
          const completed = await r.fetch();
          stored = await completed.json();
          await r.abort("failed");
        },
        { times: 1 },
      );
      await action.click();
      await page.getByRole("button", { name: "Yeniden doğrula" }).waitFor();
      assert.equal(stored.status, "complete");
      await page.reload();
      await page.getByRole("heading", { name: "Değerlendirme tamamlandı" }).waitFor();
      assert.equal(
        await board()
          .getByText(/Öğrenilen/)
          .count(),
        20,
      );
      view = stored;
    } else {
      const posted = response(page, "POST");
      await action.click();
      const reply = await posted;
      assert.equal(reply.status(), 200);
      view = await reply.json();
    }
  }
  for (const phase of ["flashcards", "matching", "meaning", "context"])
    for (let group = 1; group <= 4; group++) assert.ok(phases.has(group + "/" + phase));
  for (const phase of ["final-matching", "final-meaning", "final-context"])
    assert.ok(phases.has("4/" + phase));
  assert.equal(view.status, "complete");
  assert.equal(view.results.length, 20);
  assert.ok(view.results.every(({ score }) => score === 100));
  assert.ok(interruption && examplesChecked && finalExamplesChecked && groupExamplesChecked);
  const accountResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/account" && r.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Ana sayfa", exact: true }).click();
  const account = await (await accountResponse).json();
  assert.equal(new Set(account.progress.map(({ word_id }) => word_id)).size, 20);
  assert.equal(account.completedDays[0]?.goal, 20);
  assert.equal(account.session?.snapshot.id, view.id);
  assert.equal(account.session?.snapshot.saved, true);
  await writeFile(report, JSON.stringify({ sessionId: view.id }));
}

await verify();
