import { expect, test } from "bun:test";
import { createApp } from "../../../backend/src/app";
import { readConfig } from "../../../backend/src/config/env";
import type { RequestContext } from "../../../backend/src/shared/supabase";

test.each([
  [false, "word=obtain", 404, "INSPECTOR_DISABLED", "Word Inspector etkin değil."],
  [true, "word=obtain&word=assess", 400, "INSPECTOR_INVALID_QUERY", "Kelime araması geçersiz."],
  [
    true,
    "word=obtain",
    409,
    "INSPECTOR_ACTIVE_ASSESSMENT",
    "Çevrimiçi değerlendirmede öğrenme yardımı kapalı.",
  ],
] as const)(
  "Inspector returns the Turkish error as JSON for %s %s",
  async (enabled, query, status, code, error) => {
    const db = {
      rpc: async (name: string) => {
        expect(name).toBe("atlas_online_assessment_active");
        return { data: true, error: null };
      },
    };
    const config = readConfig({ ATLAS_FEEDBACK_LEXICON_ENABLED: String(enabled) });
    const app = createApp(config, {
      authenticate: async () => ({ userId: "synthetic-user", db }) as unknown as RequestContext,
    });
    const response = await app(new Request(`http://localhost/api/lexicon/inspect?${query}`));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, error });
  },
);
