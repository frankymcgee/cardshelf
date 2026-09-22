import { test as base } from '@playwright/test';
export { expect } from '@playwright/test';

// A hosted WebKit runner spent 26 seconds creating its first blank page, before
// navigating to CardShelf. Give page setup its own bounded budget rather than
// consuming the 30-second UI-test budget. Assertions and retries stay unchanged.
export const test = base.extend({
  page: [async ({ context }, use) => {
    // Keep the built-in per-test context: it owns cleanup, screenshots and traces.
    await use(await context.newPage());
  }, { timeout: 60_000 }]
});
