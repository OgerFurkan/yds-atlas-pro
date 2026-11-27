import { test } from "../../../frontend/config/playwright/test-fixtures";
import {
  demoOrigin,
  incompleteDayWords,
  installDayStudyMock,
  readyDayWords,
} from "../fixtures/day-study-mock";

for (const scenario of ["ready", "incomplete", "offline", "interrupted"] as const) {
  test(scenario, async ({ page, baseURL }) => {
    if (baseURL !== demoOrigin) throw new Error("Demo requires the isolated LOCAL preview.");
    await installDayStudyMock(page, {
      words: scenario === "ready" ? readyDayWords : incompleteDayWords,
      health: () => (scenario === "offline" ? 502 : 200),
      lookup: scenario === "interrupted" ? "assess" : undefined,
      complete: async (call) => {
        if (scenario !== "interrupted" || call !== 1) return 200;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return 502;
      },
    });
    await page.goto("/#library");
    await page.getByRole("tab", { name: "Günlük Plan" }).click();
    await page.pause();
  });
}
