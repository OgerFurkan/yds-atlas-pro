import { z } from "zod";
import { parseGeminiJson } from "./gemini-request";

export async function readBulkCandidate(response: Response) {
  const payload = (await response.json()) as {
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string; thought?: boolean }[] };
    }[];
  };
  const candidate = payload.candidates?.[0];
  return candidate;
}

export function parseBulkEnvelope(
  candidate: NonNullable<Awaited<ReturnType<typeof readBulkCandidate>>>,
) {
  let stage: "content" | "json" | "envelope" = "content";
  try {
    const text =
      candidate.content?.parts
        ?.filter((part) => !part.thought)
        .map((part) => part.text ?? "")
        .join("") ?? "";
    if (text.length > 200_000) throw new Error("oversized");

    // Parse the envelope separately: one malformed word must not invalidate
    // its valid neighbors. Each individual word still passes the FULL schema.
    const envelope = z.object({ suggestions: z.array(z.unknown()) }).strict();
    stage = "json";
    const parsedEnvelope = parseGeminiJson(text);
    stage = "envelope";
    const { suggestions: proposed } = envelope.parse(parsedEnvelope);
    return { proposed } as const;
  } catch {
    return { stage } as const;
  }
}
