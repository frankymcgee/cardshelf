import {fileURLToPath} from 'node:url';
import {defineConfig} from '@playwright/test';
const external = process.env.TEST_BASE_URL;
export default defineConfig({
  testDir: '.', testMatch: 'collection-ui.spec.mjs', workers: 1, retries: 0, timeout: 30000,
  outputDir: '../../test-results/collection-ui', reporter: 'list',
  use: {baseURL: external || 'http://127.0.0.1:4198', serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer']} : {}},
  projects: [{name: 'desktop', use: {browserName: 'chromium', viewport: {width: 1366, height: 900}}},
    {name: 'phone', use: {browserName: 'chromium', viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}},
    {name: 'iphone-webkit', use: {browserName: 'webkit', viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true,
      launchOptions: {}}}],
  ...(external ? {} : {webServer: {cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: 'node .output/server/index.mjs', url: 'http://127.0.0.1:4198/admin', reuseExistingServer: false, timeout: 30000,
    env: {PORT: '4198', HOST: '127.0.0.1', APP_ORIGIN: 'http://127.0.0.1:4198', EMAIL_WORKER_ENABLED: 'false', PUSH_WORKER_ENABLED: 'false', STRIPE_BILLING_ENABLED: 'false'}}}),
});
