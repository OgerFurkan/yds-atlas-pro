// Gemini 3/4 models think by default, and those tokens count against maxOutputTokens.
// Structured JSON responses get truncated unless the thinking level is lowered.
const REASONING_MODEL = /^gemini-[34](?:[.-]|$)/;

export function thinkingConfigFor(model: string) {
  return REASONING_MODEL.test(model) ? { thinkingConfig: { thinkingLevel: "low" as const } } : {};
}
