// Real server and database; provider calls and financial actions are not part of this smoke test.
import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
const baseURL = process.env.TEST_BASE_URL, database = process.env.DATABASE_URL;
const local = value => ['127.0.0.1', 'localhost'].includes(new URL(value).hostname);
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !baseURL || !database || !local(baseURL) || !local(database) || !new URL(database).pathname.endsWith('_test')) throw Error('Use a disposable localhost _test database only.');
const test = base.extend({
  admin: [async ({}, use) => {
    const sql = postgres(database, { max: 2 }), id = randomUUID(), token = randomToken();
    try {
      await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},'Release browser admin',${id + '@example.test'},${await hashPassword('Disposable release browser password 123')},'admin')`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
      await use(token);
    } finally { await sql`DELETE FROM app_users WHERE id=${id}`; await sql.end(); }
  }, { scope: 'worker' }]
});
async function inspect(page, path) {
  const errors = [], failed = [], responses = [];
  const onError = error => errors.push(error.message);
  const onResponse = response => {
    if (new URL(response.url()).origin === new URL(baseURL).origin && new URL(response.url()).pathname.startsWith('/api/')) {
      responses.push(response.status()); if (response.status() >= 500) failed.push(response.url() + ' ' + response.status());
    }
  };
  page.on('pageerror', onError); page.on('response', onResponse);
  try {
    const response = await page.goto(path); expect(response.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }).first(), path + ' page heading').toBeVisible();
    // Wait for mounted application reads; this suite contains no advertising or external provider requests.
    await page.waitForLoadState('networkidle');
    expect((await page.locator('[role="alert"]').allTextContents()).join(' ')).not.toMatch(/Internal Server Error|could not complete this request|Database is not ready/);
    expect(errors, path + ' runtime errors').toEqual([]); expect(failed, path + ' API failures').toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path + ' horizontal overflow').toBe(true);
    return responses;
  } finally { page.off('pageerror', onError); page.off('response', onResponse); }
}
test('public release pages and legacy contact links are reachable without credentials', async ({ page }) => {
  for (const path of ['/', '/features', '/pricing', '/pokemon-arena', '/contact', '/privacy', '/explore', '/register', '/login', '/forgot-password', '/reset-password']) {
    await inspect(page, path);
    if (['/', '/features', '/pricing', '/contact', '/privacy', '/login'].includes(path)) await expect(page.locator('body')).not.toContainText(/IN PRIVATE BETA|Request early access|Request testing access|implemented beta/);
  }
  await page.goto('/early-access?purpose=privacy'); await expect(page).toHaveURL(/\/contact\?purpose=privacy$/);
  await expect(page.getByLabel('What brings you here?')).toHaveValue('privacy');
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Contact layout inspection');
  await expect(page.getByRole('button', { name: 'Send my request' })).toBeVisible();
});
test('member and administrator pages boot against real authenticated APIs on both layouts', async ({ page, context, admin }, info) => {
  await context.addCookies([{ name: 'cardshelf_session', value: admin, url: baseURL, httpOnly: true, sameSite: 'Strict' }]);
  for (const path of ['/app', '/account', '/membership', '/referrals', '/emails', '/notifications', '/games', '/cards', '/binders', '/scan', '/settings', '/marketplace', '/marketplace/new', '/marketplace/inbox', '/marketplace/moderation',
    '/admin', '/admin/readiness', '/admin/pricing', '/admin/integrations/stripe', '/admin/integrations/stripe-preview', '/admin/memberships', '/admin/arena', '/admin/game-catalogue', '/admin/scanning', '/admin/emails', '/admin/passwords', '/admin/platform', '/admin/free-platform', '/admin/affiliate-shops', '/admin/adsense', '/arena', '/arena/decks/new', '/arena/tournaments']) {
    await inspect(page, path);
  }
  await page.goto('/admin/readiness');
  await expect(page.getByRole('heading', { name: 'Configuration checks', exact: true })).toBeVisible();
  await expect(page.locator('.readiness-check')).toHaveCount(17);
  await expect(page.getByRole('heading', { name: 'Acceptance checks still required', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('release-readiness.png'), fullPage: true });
});
test('registration pause directs a new member to account help rather than a beta invitation', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByText('New Free account registration is currently paused.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Ask about account access', exact: true }).click();
  await expect(page).toHaveURL(/\/contact\?purpose=early_access$/);
  await expect(page.getByLabel('What brings you here?')).toHaveValue('early_access');
});
test('WPMU SMTP settings save through authenticated APIs and reload without revealing credentials',async({page,context,admin},info)=>{
  if(process.env.EMAIL_WORKER_ENABLED!=='false')throw Error('Pause the mail worker before changing disposable SMTP settings.');
  const sql=postgres(database,{max:2}),previous=await sql`SELECT * FROM email_settings`;
  const smtpPassword='Disposable SMTP browser credential '+randomUUID();
  try{
    await sql`DELETE FROM email_settings`;
    await context.addCookies([{name:'cardshelf_session',value:admin,url:baseURL,httpOnly:true,sameSite:'Strict'}]);
    await inspect(page,'/admin/emails');
    await page.locator('#email-provider').selectOption('smtp');await page.locator('#smtp-preset').selectOption('wpmu');
    await expect(page.locator('#smtp-host')).toHaveValue('mailu.wpmudev.host');await expect(page.locator('#smtp-security')).toHaveValue('starttls');await expect(page.locator('#smtp-rate')).toHaveValue('10');
    await expect(page.getByRole('heading',{name:'External SMTP setup',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'One-time Postal setup',exact:true})).toHaveCount(0);
    await page.locator('#smtp-password').fill(smtpPassword);await page.locator('#email-admin-password').fill('Disposable release browser password 123');
    const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/emails/settings'&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Save email settings',exact:true}).click();const response=await saved;expect(response.status()).toBe(200);const data=await response.json();expect(data.provider).toBe('smtp');expect(data.smtp_password_set).toBe(true);expect(JSON.stringify(data)).not.toContain(smtpPassword);expect(data.smtp_password).toBeUndefined();
    await expect(page.getByRole('status').filter({hasText:'Email settings saved.'})).toBeVisible();
    await page.reload();await expect(page.locator('#smtp-host')).toHaveValue('mailu.wpmudev.host');await expect(page.locator('#email-provider')).toHaveValue('smtp');await expect(page.locator('#smtp-password')).toHaveValue('');await expect(page.getByRole('button',{name:'Check SMTP connection',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Send test email',exact:true})).toBeDisabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath('wpmu-email-settings.png'),fullPage:true});
  }finally{await sql`DELETE FROM email_settings`;if(previous.length)await sql`INSERT INTO email_settings ${sql(previous)}`;await sql.end();}
});
