// Real queue recovery/review -> production HTTP -> PostgreSQL. Recognition
// receipts are synthetic; this test never sends photos to an external provider.
import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
import {batchSnapshot} from '../../shared/scan-batch.mjs';
const enabled=process.env.ALLOW_TEST_DATABASE==='yes'&&!!process.env.TEST_BASE_URL;
if(enabled&&!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Use a disposable _test database only.');
test('restored batch reviews persist once and reuse the exact binder pocket against PostgreSQL',async({page,context})=>{
  test.skip(!enabled,'Requires the isolated CI PostgreSQL server');
  const sql=postgres(process.env.DATABASE_URL,{max:2}),owner=randomUUID(),token=randomToken(),suffix=randomUUID(),scans=[randomUUID(),randomUUID()];
  const setId='en:batch-browser-'+suffix,cardId=setId+'-025';let binder,holo;
  const requests=[];page.on('request',r=>{if(r.method()==='POST')requests.push(new URL(r.url()).pathname)});
  try{
    await sql`INSERT INTO app_users(id,name,email,password_hash) VALUES(${owner},'Batch browser fixture',${owner+'@example.test'},${await hashPassword('Batch browser fixture 123')})`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${owner},now()+interval '1 hour')`;
    await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${setId},${suffix},'en','Batch browser set')`;
    await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${cardId},${suffix+'-025'},${setId},'en','025','Batch browser Pikachu')`;
    await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},'normal','Normal','tcgdex')`;
    [holo]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},'holo','Holo','tcgdex') RETURNING id`;
    [binder]=await sql`INSERT INTO binders(user_id,title,columns,rows,page_count,binder_type) VALUES(${owner},'Batch browser binder',2,2,1,'collection') RETURNING id`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes) VALUES(${owner},${holo.id},'UNKNOWN',2,true,'Private batch notes')`;
    const observation={card_count:1,readable:true,card_name:'Batch browser Pikachu',collector_number:'025',printed_total:null,set_code:null,set_name:null,language:'en'};
    for(const id of scans)await sql`INSERT INTO card_scans(id,user_id,image_hash,model,status,budget_month,accounted_micros,input_price_micros,output_price_micros,observations,candidate_ids,settled)
      VALUES(${id},${owner},${'a'.repeat(64)},'synthetic','ready',date_trunc('month',now() AT TIME ZONE 'UTC')::date,0,1,1,${sql.json(observation)},${[cardId]},true)`;
    await context.addCookies([{name:'cardshelf_session',value:token,url:process.env.TEST_BASE_URL,httpOnly:true,sameSite:'Lax'}]);
    const snapshot=batchSnapshot(owner,scans.map((id,i)=>({id,fingerprint:String(i+1).repeat(64),submitted:true,skipped:false})));
    await page.addInitScript(({key,snapshot})=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,snapshot)},{key:'cardshelf.scan-batch.v1:'+owner,snapshot});
    await page.goto('/scan?mode=batch&binder='+binder.id);await expect(page.locator('.batch-notice')).toContainText('Queue restored');
    for(let i=0;i<2;i++){
      await page.getByRole('button',{name:'Review photo '+(i+1),exact:true}).click();await page.locator('.scan-candidate').click();await page.getByLabel('Printing / finish',{exact:true}).selectOption(holo.id);
      await expect(page.locator('.scan-ownership')).toContainText('You own '+(2+i));await expect(page.getByTestId('scan-placement')).toContainText('Page 1, pocket 1');
      await page.getByRole('button',{name:'Confirm & add to collection',exact:true}).click();await expect(page.getByRole('heading',{name:'Another card on your shelf.'})).toBeVisible();
    }
    await page.reload();await expect(page.locator('.batch-item .badge.green')).toHaveCount(2);await expect(page.getByRole('heading',{name:'Another card on your shelf.'})).toBeVisible();
    const [entry]=await sql`SELECT quantity,wishlist,notes FROM collection_entries WHERE user_id=${owner} AND printing_id=${holo.id}`;
    expect(entry).toEqual({quantity:4,wishlist:true,notes:'Private batch notes'});expect((await sql`SELECT count(*)::integer AS n FROM binder_slots WHERE binder_id=${binder.id}`)[0].n).toBe(1);
    await page.getByRole('button',{name:'Undo this addition'}).click();await expect(page.getByRole('heading',{name:'Addition undone.'})).toBeVisible();
    expect((await sql`SELECT quantity FROM collection_entries WHERE user_id=${owner} AND printing_id=${holo.id}`)[0].quantity).toBe(3);
    expect(requests.filter(p=>p==='/api/scans')).toHaveLength(0);expect(requests.filter(p=>p.endsWith('/confirm'))).toHaveLength(2);
  }finally{
    await sql`DELETE FROM card_scans WHERE id IN ${sql(scans)}`;await sql`DELETE FROM audit_log WHERE user_id=${owner}`;await sql`DELETE FROM app_users WHERE id=${owner}`;
    await sql`DELETE FROM printings WHERE card_id=${cardId}`;await sql`DELETE FROM cards WHERE id=${cardId}`;await sql`DELETE FROM card_sets WHERE id=${setId}`;
    await sql`DELETE FROM auth_attempts WHERE bucket IN ${sql(['card-scan-read:','card-scan-write:','card-scan-upload:'].map(p=>digest(p+owner)))}`;await sql.end();
  }
});
