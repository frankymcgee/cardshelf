import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: ['arena-table.spec.mjs', 'arena-play.spec.mjs'], timeout: 30000, retries: 0, workers: 1,
  outputDir: '../../test-results/arena-table', reporter: [['list'], ['html', { outputFolder: 'playwright-report/arena-table', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4179', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: { cwd: fileURLToPath(new URL('../../', import.meta.url)), command: 'node tests/browser/arena-preview-server.mjs', url: 'http://127.0.0.1:4179', reuseExistingServer: false, timeout: 30000 }
});
