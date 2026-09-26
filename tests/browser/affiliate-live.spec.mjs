// Real browser -> HTTP -> PostgreSQL publication flow. Never opens a retailer.
import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Use a disposable _test database only.');
test('saved active Amazon links really appear in Browse cards and disappear when paused',async({page,context},info)=>{
  const sql=postgres(process.env.DATABASE_URL,{max:2}),id=randomUUID(),token=randomToken(),password='Affiliate browser fixture 123';let original;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    [original]=await sql`SELECT * FROM affiliate_shop_settings WHERE singleton`;
    expect(original).toBeTruthy();await sql`UPDATE affiliate_shop_settings SET enabled=false,shops='[]'::jsonb WHERE singleton`;
    await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},'Affiliate browser fixture',${id+'@example.test'},${await hashPassword(password)},'admin')`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
    await context.addCookies([{name:'cardshelf_session',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);
    await page.goto('/admin/affiliate-shops');
    const publication=page.getByTestId('affiliate-publication');await expect(publication).toContainText('No saved affiliate links');
    await page.getByRole('button',{name:'Add Amazon starter links',exact:true}).click();
    const url='https://www.amazon.com.au/dp/ABCDEFGHIJ?tag=fixture-22&linkCode=ll1';
    for(const field of await page.getByLabel('Affiliate shop URL',{exact:true}).all())await field.fill(url);
    await page.getByLabel('Enable this shop').nth(0).check();
    await page.getByLabel('Enable this shop').nth(2).check();await page.getByLabel('Optional end date').nth(2).fill('2000-01-01');
    await page.getByLabel('Show affiliate shopping links').check();
    await page.getByLabel('Current administrator password').fill(password);await page.getByRole('button',{name:'Save affiliate shops',exact:true}).click();
    await expect(publication).toContainText('1 saved link is available');await expect(publication).toContainText('Card binders');
    await page.getByRole('link',{name:'View marketplace',exact:true}).click();
    const panel=page.getByTestId('affiliate-shops');await expect(panel).toBeVisible();
    await expect(panel.locator('a')).toHaveCount(1);const link=panel.getByRole('link',{name:'Card binders on Amazon (opens in a new tab)'});
    await expect(link).toHaveAttribute('href',url);await expect(link).toHaveAttribute('rel','sponsored nofollow noopener');
    await expect(page.getByTestId('amazon-disclosure')).toBeVisible();
    await page.getByLabel('Search',{exact:true}).fill('English booster packs');await expect(link).toHaveAttribute('href',url);
    await page.screenshot({path:info.outputPath('published-affiliate-marketplace.png'),fullPage:true});
    await page.getByRole('link',{name:'My listings',exact:true}).click();await expect(panel).toHaveCount(0);
    await page.goto('/admin/affiliate-shops');await expect(publication).toContainText('1 saved link is available');
    await page.getByLabel('Show affiliate shopping links').uncheck();await page.getByLabel('Current administrator password').fill(password);await page.getByRole('button',{name:'Save affiliate shops',exact:true}).click();
    await expect(publication).toContainText('No saved affiliate links');
    const pausedResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/public/affiliate-shops');
    await page.getByRole('link',{name:'View marketplace',exact:true}).click();
    expect(await (await pausedResponse).json()).toEqual({shops:[]});
    await expect(page.getByRole('heading',{name:'Find your next favourite',exact:true})).toBeVisible();await expect(panel).toHaveCount(0);expect(errors).toEqual([]);
  }finally{
    if(original)await sql`UPDATE affiliate_shop_settings SET enabled=${original.enabled},shops=${sql.json(original.shops)},revision=${original.revision},updated_by=${original.updated_by},updated_at=${original.updated_at} WHERE singleton`;
    await sql`DELETE FROM audit_log WHERE user_id=${id}`;await sql`DELETE FROM app_users WHERE id=${id}`;await sql`DELETE FROM auth_attempts WHERE bucket=${digest('affiliate-shops-admin:'+id)}`;await sql.end();
  }
});
