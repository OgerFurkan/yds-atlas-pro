import { test as base } from "@playwright/test";
import { mockOrigin } from "./loopback";

export { expect, type Page } from "@playwright/test";
export const test = base.extend<{ blockUnmockedAuth: undefined }>({
  blockUnmockedAuth: [
    async ({ context }, use) => {
      // Page-level mocks take precedence over this fallback.
      await context.route(`${mockOrigin}/auth/v1/**`, (route) => route.abort("blockedbyclient"));
      await use(undefined);
    },
    { auto: true },
  ],
});
