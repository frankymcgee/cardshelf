import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'.',testMatch:'affiliate-live.spec.mjs',timeout:60000,retries:0,workers:1,
  outputDir:'../../test-results/affiliate-live',reporter:'list',
  use:{baseURL:process.env.TEST_BASE_URL,screenshot:'only-on-failure',trace:'retain-on-failure',browserName:'chromium',viewport:{width:1366,height:900},launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}}
});
