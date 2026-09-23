import { defineConfig } from '@playwright/test';
const baseURL = process.env.TEST_BASE_URL;
if (!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || process.env.ARENA_BROWSER_TEST !== 'yes') {
  throw Error('Arena match tests require explicit disposable-localhost test settings.');
}
export default defineConfig({
  testDir: '.', testMatch: ['arena-match.spec.mjs', 'arena-workshop.spec.mjs'], workers: 1, fullyParallel: false, retries: 0,
  timeout: 30_000, expect: { timeout: 5_000 },
  outputDir: '../../test-results/arena-match',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/arena-match', open: 'never' }]],
  // Network fault injection must reach page.route in both browsers. This suite tests
  // the online match, not the installable/offline shell; production SW behaviour is unchanged.
  use: { baseURL, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }]
});
