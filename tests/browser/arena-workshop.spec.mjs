import { test, expect, json } from './arena-match-fixtures.mjs';
import { randomUUID } from 'node:crypto';
async function seed(sql) {
 const suffix=randomUUID().replaceAll('-',''),set='en:browser-workshop-'+suffix,basic=set+'-1',energy=set+'-2';
 await sql`INSERT INTO card_sets(id,provider_id,game,language,name,card_count) VALUES(${set},${set.slice(3)},'pokemon','en','Browser workshop set',2)`;
 for(const [id,name,raw] of [[basic,'Browser Workshop Basic',{category:'Pokemon',stage:'Basic',hp:100,types:['Fire'],retreat:1,attacks:[{name:'Tackle',damage:30,cost:['Colorless']}]}],[energy,'Fire Energy',{category:'Energy',energyType:'Basic',effect:'Basic Energy'}]])await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,category,raw_data) VALUES(${id},${id.slice(3)},${set},'pokemon','en',${id.at(-1)},${name},${raw.category},${sql.json(raw)})`;
 return {set,basic,energy,export:JSON.stringify({format:'cardshelf-arena-deck',version:1,game:'pokemon',title:'Workshop contender',cards:[{card_id:basic,quantity:4},{card_id:energy,quantity:56}]})};
}
async function clean(sql,fixture){await sql`DELETE FROM cards WHERE set_id=${fixture.set}`;await sql`DELETE FROM card_sets WHERE id=${fixture.set}`;}

test('lobby highlights the active match and returns to the same private table',async({page,game},info)=>{
 const tables=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/arena/matches'&&r.request().method()==='GET');
 await page.goto('/arena');expect((await json(await tables)).matches.some(m=>m.id===game.id&&m.status==='active')).toBe(true);await expect(page.getByRole('heading',{name:'Continue match',exact:true})).toBeVisible();
 await expect(page.locator('.aw-mode-card')).toHaveCount(3);
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('lobby-mobile.png'),fullPage:true});
 await page.locator('.aw-continue').click();await page.waitForURL('**/arena/matches/'+game.id);
 await expect(page.getByRole('region',{name:'Match status'})).toBeVisible();
});

test('review import, save, export and duplicate use real private deck APIs',async({page,context,environment},info)=>{
 const fixture=await seed(environment.sql);
 try{
  await page.goto('/arena/decks/new');await expect(page.getByRole('heading',{name:'Find your cards'})).toBeVisible();
  await page.getByRole('combobox',{name:'Imported set',exact:true}).selectOption(fixture.set);
  await expect(page.locator('.aw-catalogue-card')).toHaveCount(2);
  await page.getByRole('combobox',{name:'Card category',exact:true}).selectOption('pokemon');await expect(page.locator('.aw-catalogue-card')).toHaveCount(1);
  await page.locator('.aw-catalogue-card .arena-card').click();const dialog=page.getByRole('dialog',{name:'Browser Workshop Basic'});await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  await page.locator('.aw-import > summary').first().click();await page.getByLabel('Deck list',{exact:true}).fill(fixture.export);
  await page.getByRole('button',{name:'Review import',exact:true}).click();const review=page.getByRole('region',{name:'Import review'});await expect(review).toContainText('ready to play once saved');
  await page.getByRole('button',{name:'Apply to draft',exact:true}).click();await expect(page.getByLabel('Deck name',{exact:true})).toHaveValue('Workshop contender');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/arena/decks'&&r.request().method()==='POST');await page.getByRole('button',{name:'Save deck',exact:true}).click();const original=await json(await response);await page.waitForURL('**/arena/decks/'+original.id);
  await expect(page.getByLabel('Deck name',{exact:true})).toHaveValue('Workshop contender');await expect(page.locator('.arena-validation')).toContainText('Ready for Casual Expanded');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export list',exact:true}).click();expect((await download).suggestedFilename()).toBe('cardshelf-arena-deck.json');
  await page.getByRole('link',{name:'Duplicate saved deck',exact:true}).click();await expect(page.getByLabel('Deck name',{exact:true})).toHaveValue('Workshop contender (copy)');await expect(page.locator('.arena-alert[role=status]')).toContainText('separate copy');
  await page.getByLabel('Deck name',{exact:true}).fill('Different strategy');const duplicateReply=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/arena/decks'&&r.request().method()==='POST');await page.getByRole('button',{name:'Save deck',exact:true}).click();const duplicate=await json(await duplicateReply);expect(duplicate.id).not.toBe(original.id);await page.waitForURL('**/arena/decks/'+duplicate.id);
  expect((await json(await context.request.get('/api/arena/decks/'+original.id))).title).toBe('Workshop contender');
  await page.screenshot({path:info.outputPath('workshop-desktop.png'),fullPage:true});
  await page.getByLabel('Deck name',{exact:true}).fill('Unsaved name');page.once('dialog',d=>d.dismiss());await page.getByRole('link',{name:'Duplicate saved deck',exact:true}).click();expect(new URL(page.url()).pathname).toBe('/arena/decks/'+duplicate.id);page.once('dialog',d=>d.dismiss());await page.getByRole('link',{name:'Back to your Arena',exact:false}).click();expect(new URL(page.url()).pathname).toBe('/arena/decks/'+duplicate.id);
 }finally{await clean(environment.sql,fixture);}
});

test('mobile workshop keeps import replacement deliberate and card inspection reachable',async({page,environment},info)=>{
 const fixture=await seed(environment.sql);
 try{
  await page.setViewportSize({width:390,height:844});await page.goto('/arena/decks/new');
  await page.getByRole('combobox',{name:'Imported set',exact:true}).selectOption(fixture.set);await expect(page.locator('.aw-catalogue-card')).toHaveCount(2);
  await page.getByRole('button',{name:'Add Browser Workshop Basic to deck',exact:true}).click();
  await page.locator('.aw-import > summary').first().click();await page.getByLabel('Deck list',{exact:true}).fill(fixture.export);await page.getByRole('button',{name:'Review import',exact:true}).click();
  const apply=page.getByRole('button',{name:'Apply to draft',exact:true});await expect(apply).toBeDisabled();await page.getByLabel('Replace the cards in my current draft').check();await apply.click();
  await expect(page.getByLabel('Deck name',{exact:true})).toBeVisible();await expect(page.locator('.aw-count-heading')).toContainText('60');
  await page.getByRole('button',{name:'Card catalogue',exact:true}).click();await expect(page.getByRole('combobox',{name:'Imported set',exact:true})).toBeVisible();
  await page.locator('.aw-catalogue-card .arena-card').first().click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  await page.setViewportSize({width:320,height:740});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('workshop-mobile.png'),fullPage:true});
 }finally{await clean(environment.sql,fixture);}
});
