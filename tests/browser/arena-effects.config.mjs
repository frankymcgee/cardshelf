import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'arena-effects.spec.mjs', timeout: 30000, retries: 0, workers: 1,
  outputDir: '../../test-results/arena-effects', reporter: [['list'], ['html', { outputFolder: 'playwright-report/arena-effects', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4180', screenshot: 'only-on-failure', trace: 'retain-on-failure', viewport: { width: 1440, height: 1700 } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: { cwd: fileURLToPath(new URL('../../', import.meta.url)), command: 'node tests/browser/arena-effects-server.mjs', url: 'http://127.0.0.1:4180', reuseExistingServer: false, timeout: 30000 }
});
