import {fileURLToPath} from 'node:url';
import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'.',testMatch:'pricing-admin.spec.mjs',timeout:30000,retries:0,workers:1,
  outputDir:'../../test-results/pricing-admin',reporter:'list',
  use:{baseURL:'http://127.0.0.1:4185',screenshot:'only-on-failure',trace:'retain-on-failure',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}},
  projects:[{name:'desktop',use:{browserName:'chromium',viewport:{width:1366,height:900}}},{name:'phone',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
  webServer:{cwd:fileURLToPath(new URL('../../',import.meta.url)),command:'node .output/server/index.mjs',url:'http://127.0.0.1:4185/admin',reuseExistingServer:false,timeout:30000,
    env:{PORT:'4185',HOST:'127.0.0.1',APP_ORIGIN:'http://127.0.0.1:4185',EMAIL_WORKER_ENABLED:'false',STRIPE_BILLING_ENABLED:'false'}}
});
