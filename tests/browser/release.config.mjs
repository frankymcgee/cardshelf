import { defineConfig } from '@playwright/test';
const baseURL = process.env.TEST_BASE_URL, database = process.env.DATABASE_URL;
const local = value => ['127.0.0.1', 'localhost'].includes(new URL(value).hostname);
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !baseURL || !database || !local(baseURL) || !local(database) || !new URL(database).pathname.endsWith('_test')) throw Error('Release browser inspection requires a disposable localhost _test installation.');
export default defineConfig({
  testDir: '.', testMatch: 'release.spec.mjs', workers: 1, retries: 0, timeout: 120_000,
  outputDir: '../../test-results/release', reporter: 'list',
  use: { baseURL, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 900 } } },
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }]
});
