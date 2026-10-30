import { test, expect, json } from './arena-match-fixtures.mjs';
import { randomUUID } from 'node:crypto';
import { gameRow } from '../helpers/arena-multigame-fixtures.mjs';
for(const game of ['yugioh','mtg'])test(game+' workshop, saved-deck practice and mobile table',async({page,environment},info)=>{
  const suffix=randomUUID().replaceAll('-',''),set=`${game}:en:browser-${suffix}`,sql=environment.sql;
  await sql`INSERT INTO card_sets(id,provider_id,game,language,name,card_count) VALUES(${set},${'browser-'+suffix},${game},'en','Browser multi-game set',20)`;
  const rows=game==='yugioh'?Array.from({length:14},(_,i)=>({row:gameRow(game,'Browser Normal '+i+' '+suffix),quantity:i===13?1:3})):
    [{row:gameRow(game,'Forest',{arena_data:{types:['Land'],supertypes:['Basic']},row:{id:`mtg:en:forest-${suffix}`,category:'Basic Land — Forest'}}),quantity:24},...Array.from({length:9},(_,i)=>({row:gameRow(game,'Browser Creature '+i+' '+suffix),quantity:4}))];
  try{
    for(const {row:r} of rows)await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,category,raw_data) VALUES(${r.id},${r.id.split(':').at(-1)},${set},${game},'en','1',${r.name},${r.category},${sql.json(r.raw_data)})`;
    await page.setViewportSize({width:390,height:844});await page.goto('/arena');
    await page.getByRole('combobox',{name:'Card game',exact:true}).selectOption(game);await expect(page.locator('.aw-mode-card')).toHaveCount(2);
    await page.getByRole('link',{name:'+ New deck',exact:true}).click();await expect(page.getByRole('combobox',{name:'Card game',exact:true})).toHaveValue(game);
    await page.locator('.aw-import > summary').first().click();await page.getByLabel('Deck list',{exact:true}).fill(JSON.stringify({format:'cardshelf-arena-deck',version:1,game,title:'Multi-game contender',cards:rows.map(({row,quantity})=>({card_id:row.id,quantity}))}));
    await page.getByRole('button',{name:'Review import',exact:true}).click();await expect(page.getByRole('region',{name:'Import review'})).toContainText('ready to play once saved');
    await page.getByRole('button',{name:'Apply to draft',exact:true}).click();
    const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/arena/decks'&&r.request().method()==='POST');await page.getByRole('button',{name:'Save deck',exact:true}).click();const deck=await json(await saved);await page.waitForURL('**/arena/decks/'+deck.id);
    await expect(page.locator('.aw-workshop-layout')).toHaveClass(/show-deck/);
    await expect(page.getByRole('link',{name:'Back to play',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'Back to play',exact:true}).click();await page.getByRole('combobox',{name:'Card game',exact:true}).selectOption(game);await page.getByRole('combobox',{name:'Saved deck',exact:true}).selectOption(deck.id);await page.getByRole('combobox',{name:'Opponent deck',exact:true}).selectOption('mirror');
    await page.getByRole('button',{name:'Play the computer',exact:true}).click();await page.waitForURL('**/arena/matches/*');
    await expect(page.getByRole('region',{name:(game==='mtg'?'Magic: The Gathering':'Yu-Gi-Oh!')+' table'})).toBeVisible();await expect(page.locator('.game-life').first()).toContainText(game==='mtg'?'20':'8000');
    await page.locator('.game-hand .arena-card').first().click();await expect(page.locator('.game-controls h3')).not.toHaveText('Your next move');
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(game+'-table-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(game+'-table-desktop.png'),fullPage:true});
  }finally{await sql`DELETE FROM cards WHERE set_id=${set}`;await sql`DELETE FROM card_sets WHERE id=${set}`;}
});
