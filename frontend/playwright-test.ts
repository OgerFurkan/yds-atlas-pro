import { test as base } from "@playwright/test";
import { mockOrigin } from "./playwright-local";

export { expect, type Page } from "@playwright/test";
export const test = base.extend<{ blockUnmockedAuth: void }>({
  blockUnmockedAuth: [
    async ({ context }, use) => {
      // Page-level mocks take precedence over this fallback.
      await context.route(`${mockOrigin}/auth/v1/**`, (route) => route.abort("blockedbyclient"));
      await use();
    },
    { auto: true },
  ],
});
