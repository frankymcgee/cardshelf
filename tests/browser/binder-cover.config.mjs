import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
const external=process.env.TEST_BASE_URL;
export default defineConfig({
  testDir:'.',testMatch:'binder-cover.spec.mjs',timeout:45000,retries:0,workers:1,
  outputDir:'../../test-results/binder-cover',reporter:'list',
  use:{baseURL:external||'http://127.0.0.1:4199',screenshot:'only-on-failure',trace:'retain-on-failure',
    launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}},
  projects:[{name:'desktop',use:{browserName:'chromium',viewport:{width:1366,height:1000}}},
    {name:'phone',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
  ...(external?{}:{webServer:{cwd:fileURLToPath(new URL('../../',import.meta.url)),command:'node .output/server/index.mjs',url:'http://127.0.0.1:4199/admin',reuseExistingServer:false,timeout:30000,
    env:{PORT:'4199',HOST:'127.0.0.1',APP_ORIGIN:'http://127.0.0.1:4199',EMAIL_WORKER_ENABLED:'false',PUSH_WORKER_ENABLED:'false',STRIPE_BILLING_ENABLED:'false'}}})
});
