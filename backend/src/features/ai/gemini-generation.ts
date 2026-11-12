// Gemini 3/4 models think by default, and those tokens count against maxOutputTokens.
// Structured JSON responses get truncated unless the thinking level is lowered.
const REASONING_MODEL = /^gemini-[34](?:[.-]|$)/;
// Flash-Lite models already default to "minimal" thinking; raising it would only add
// latency and spend output budget on thoughts.
const LITE_MODEL = /-lite(?:$|[-.])/;

export function thinkingConfigFor(model: string) {
  if (LITE_MODEL.test(model)) return {};
  return REASONING_MODEL.test(model) ? { thinkingConfig: { thinkingLevel: "low" as const } } : {};
}
