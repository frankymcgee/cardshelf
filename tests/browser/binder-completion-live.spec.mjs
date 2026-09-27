// Real browser -> HTTP -> PostgreSQL. Isolated synthetic users and cards only.
import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
const enabled=process.env.ALLOW_TEST_DATABASE==='yes'&&!!process.env.TEST_BASE_URL;
if(enabled&&!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Use a disposable _test database only.');
test('binder link, bulk wishlist persistence and exact member listing navigation work against PostgreSQL',async({page,context})=>{
  test.skip(!enabled,'Requires the isolated CI PostgreSQL server');
  const sql=postgres(process.env.DATABASE_URL,{max:2}),owner=randomUUID(),seller=randomUUID(),token=randomToken(),suffix=randomUUID();
  const setId='en:completion-browser-'+suffix,cardId=setId+'-1';let binder,normal,holo,listing;
  try{
    const hash=await hashPassword('Completion browser fixture 123');
    for(const id of [owner,seller])await sql`INSERT INTO app_users(id,name,email,password_hash) VALUES(${id},'Completion browser fixture',${id+'@example.test'},${hash})`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${owner},now()+interval '1 hour')`;
    await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${setId},${suffix},'en','Completion browser set')`;
    await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${cardId},${suffix+'-1'},${setId},'en','1','Browser Pikachu')`;
    [normal]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},'normal','Normal','tcgdex') RETURNING id`;
    [holo]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},'holo','Holo','tcgdex') RETURNING id`;
    [binder]=await sql`INSERT INTO binders(user_id,title,columns,rows,page_count,binder_type) VALUES(${owner},'Browser completion binder',2,2,1,'collection') RETURNING id,revision`;
    await sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${binder.id},0,${normal.id}),(${binder.id},1,${holo.id})`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,notes) VALUES(${owner},${normal.id},'NM',2,'Keep my copies')`;
    [listing]=await sql`INSERT INTO marketplace_listings(seller_id,request_id,input_hash,printing_id,seller_alias,condition,price_minor,delivery,postage_minor,region,description)
      VALUES(${seller},${randomUUID()},'fixture',${holo.id},'Browser seller','NM',2500,'pickup',0,'Perth','Synthetic listing for a browser test.') RETURNING id`;
    await context.addCookies([{name:'cardshelf_session',value:token,url:process.env.TEST_BASE_URL,httpOnly:true,sameSite:'Lax'}]);
    await page.goto('/binders/'+binder.id);await page.getByRole('link',{name:'Complete this binder',exact:true}).click();
    await expect(page).toHaveURL(new RegExp('/binders/complete/'+binder.id+'$'));
    await expect(page.locator('.completion-card')).toHaveCount(1);await expect(page.locator('.completion-card')).toContainText('Holo');
    await page.getByLabel('Select Browser Pikachu · Holo · EN',{exact:true}).check();await page.getByRole('button',{name:'Add selected to wishlist',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('1 printing added');await page.reload();await expect(page.locator('.completion-card')).toContainText('On your wishlist');
    const [wish]=await sql`SELECT quantity,condition,wishlist,notes FROM collection_entries WHERE user_id=${owner} AND printing_id=${holo.id}`;
    expect(wish).toEqual({quantity:0,condition:'UNKNOWN',wishlist:true,notes:''});
    expect((await sql`SELECT quantity,notes FROM collection_entries WHERE user_id=${owner} AND printing_id=${normal.id}`)[0]).toEqual({quantity:2,notes:'Keep my copies'});
    expect((await sql`SELECT revision FROM binders WHERE id=${binder.id}`)[0].revision).toBe(binder.revision);
    await page.getByRole('button',{name:'View 1 listing',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Browser seller');
    await page.getByRole('dialog').getByRole('link',{name:'View listing',exact:true}).click();await expect(page).toHaveURL(new RegExp('/marketplace/'+listing.id+'$'));
    await expect(page.locator('.market-detail')).toContainText('Browser seller');
  }finally{
    await sql`DELETE FROM audit_log WHERE user_id IN (${owner},${seller})`;await sql`DELETE FROM app_users WHERE id IN (${owner},${seller})`;
    await sql`DELETE FROM printings WHERE card_id=${cardId}`;await sql`DELETE FROM cards WHERE id=${cardId}`;await sql`DELETE FROM card_sets WHERE id=${setId}`;
    await sql`DELETE FROM auth_attempts WHERE bucket IN ${sql([digest('binder-completion-read:'+owner),digest('binder-completion-write:'+owner)])}`;await sql.end();
  }
});
