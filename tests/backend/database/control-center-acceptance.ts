import { expect } from "bun:test";
import { createHmac } from "node:crypto";
import { createApp } from "../../../backend/src/app";
import { readConfig } from "../../../backend/src/config/env";
import type { AiWordResponse } from "../../../packages/shared/src/index";

function totp(secret: string) {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((c) => digits.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((v) => parseInt(v, 2)));
  const digest = createHmac("sha1", key).update(counter).digest(),
    offset = digest[19] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
function suggestion(word: string): AiWordResponse["suggestion"] {
  return {
    word,
    partOfSpeech: "Verb",
    alternatives: [],
    meanings: ["elde etmek"],
    usageNote: "Geçişli fiil.",
    cefr: "B2",
    examples: [
      "We often " + word + " evidence.",
      "They " + word + " resources today.",
      "We can " + word + " enough evidence to draw a conclusion.",
      "Our research teams must " +
        word +
        " reliable evidence before they can publish these detailed findings today.",
      "The researchers who " +
        word +
        " crucial evidence will publish the results after independent experts have reviewed their findings.",
    ].map((sentence, i) => ({
      sentence,
      translation: "Yeni kanıt elde etmek gerekir.",
      translationFocus: ["elde etmek"],
      difficulty: i < 2 ? "easy" : i === 2 ? "medium" : "yds",
    })),
  };
}
export async function verifyControlCenter(
  gateway: string,
  a: { id: string; token: string },
  b: { token: string },
  serviceKey: string,
) {
  const requests: string[] = [];
  const app = createApp(
    readConfig({
      SUPABASE_URL: gateway,
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: serviceKey,
      ATLAS_CONTROL_OWNER_ID: a.id,
      ATLAS_FEEDBACK_LEXICON_ENABLED: "true",
      GEMINI_API_KEY: "synthetic-only",
    }),
    {
      generate: async (word) => {
        requests.push(word);
        return { suggestion: suggestion(word), model: "synthetic", provider: "Gemini" };
      },
      consumeQuota: async () => true,
    },
  );
  const api = (path: string, token: string, body?: unknown) =>
    app(
      new Request("http://127.0.0.1" + path, {
        method: body ? "POST" : "GET",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  expect((await api("/api/control", b.token)).status).toBe(403);
  expect((await api("/api/control", a.token)).status).toBe(403);
  for (const token of [a.token, b.token]) {
    const denied = await api("/api/control/ai-status", token);
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("Key 01");
  }
  const factor = async (path: string, body: unknown) => {
    const response = await fetch(gateway + "auth/v1/" + path, {
      method: "POST",
      headers: { Authorization: "Bearer " + a.token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.ok).toBe(true);
    return response.json();
  };
  const enrolled = await factor("factors", {
    factor_type: "totp",
    friendly_name: "Synthetic LOCAL factor",
  });
  const challenge = await factor("factors/" + enrolled.id + "/challenge", {});
  const verified = await factor("factors/" + enrolled.id + "/verify", {
    challenge_id: challenge.id,
    code: totp(enrolled.totp.secret),
  });
  const token = verified.access_token;
  const diagnostic = await api("/api/control/ai-status", token);
  expect(diagnostic.status).toBe(200);
  const pool = await diagnostic.json();
  expect(pool.keys).toMatchObject([{ id: "Key 01", state: "unknown" }]);
  expect(JSON.stringify(pool)).not.toContain("synthetic-only");
  expect((await api("/api/control", token)).status).toBe(200);
  const generated = await api("/api/control/draft", token, { word: "obtain" });
  expect(generated.status).toBe(200);
  const draft = await generated.json();
  const legacyPath = "/api/control/legacy?word=acquire";
  const original = await (await api(legacyPath, token)).json();
  expect(original.length).toBe(1);
  const { id, revision, digest } = original[0];
  const licensed = {
    license: "CC BY-SA 4.0",
    source: original[0].provenance.url,
    attribution: "Synthetic licensed fixture",
  };
  const items = [
    { entryId: null, revision: 0, ...draft },
    {
      entryId: null,
      revision: 0,
      content: suggestion("acquire"),
      provenance: licensed,
      legacy: { id, revision, digest },
    },
  ];
  const command = { operation: crypto.randomUUID(), action: "publish", items };
  expect((await api("/api/control/revisions", b.token, command)).status).toBe(403);
  const submit = (body: unknown) => api("/api/control/revisions", token, body);
  const result = await submit(command);
  expect(result.status).toBe(200);
  const published = await result.json();
  expect(published.length).toBe(2);
  expect(await (await submit(command)).json()).toEqual(published);
  const preview = () => api("/api/lexicon/preview?word=obtains&word=absent", b.token);
  expect(await (await preview()).json()).toMatchObject([{ word: "obtain", revision: 1 }]);
  const stale = {
    operation: crypto.randomUUID(),
    action: "quarantine",
    entryId: published[0].id,
    revision: 2,
    reason: "Sentetik kontrol",
  };
  expect((await submit(stale)).status).toBe(409);
  expect((await submit({ ...stale, revision: 1 })).status).toBe(200);
  expect(await (await preview()).json()).toEqual([]);
  expect(
    (await submit({ ...stale, operation: crypto.randomUUID(), action: "restore", target: 1 }))
      .status,
  ).toBe(200);
  expect(await (await preview()).json()).toMatchObject([{ word: "obtain", revision: 3 }]);
  const history = await (await api("/api/control/history?id=" + published[0].id, token)).json();
  expect(history.map((r: { revision: number }) => r.revision)).toEqual([3, 2, 1]);
  expect(history.every((r: { actor_id: string }) => r.actor_id === a.id)).toBe(true);
  expect(await (await api(legacyPath, token)).json()).toEqual(original);
  const linked = await (await api("/api/control/entries?word=acquire", token)).json();
  expect(linked[0].provenance).toMatchObject({ ...licensed, legacy: { id, revision, digest } });
  const secondSense = { ...items[0], content: { ...draft.content, meanings: ["edinmek"] } };
  expect(
    (await submit({ action: "publish", items: [secondSense], operation: crypto.randomUUID() }))
      .status,
  ).toBe(200);
  expect((await (await preview()).json()).length).toBe(2);
  const correction = {
    ...items[0],
    entryId: published[0].id,
    revision: 3,
    content: { ...draft.content, meanings: ["kazanmak"] },
  };
  expect(
    (await submit({ action: "publish", operation: crypto.randomUUID(), items: [correction] }))
      .status,
  ).toBe(200);
  const updated = await (await preview()).json();
  expect(updated.find((r: { id: string }) => r.id === published[0].id).meanings).toEqual([
    "kazanmak",
  ]);
  expect(
    (
      await submit({
        ...stale,
        action: "restore",
        operation: crypto.randomUUID(),
        revision: 4,
        target: 1,
      })
    ).status,
  ).toBe(200);
  expect(
    (await (await preview()).json()).find((r: { id: string }) => r.id === published[0].id).meanings,
  ).toEqual(["elde etmek"]);
  const duplicate = { ...items[0], content: suggestion("acquire") };
  expect(
    (
      await submit({
        action: "publish",
        operation: crypto.randomUUID(),
        items: [{ ...items[0], content: suggestion("retain") }, duplicate],
      })
    ).status,
  ).toBe(409);
  expect(await (await api("/api/control/entries?word=retain", token)).json()).toEqual([]);
  expect(requests).toEqual(["obtain"]);
}
