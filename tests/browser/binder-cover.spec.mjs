import {test,expect} from '@playwright/test';
import sharp from 'sharp';
const binderId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',shareToken='c'.repeat(64);
const insideVersion='a'.repeat(64),coverVersion='b'.repeat(64);
const coverImage=await sharp({create:{width:120,height:160,channels:3,background:'#b16c38'}}).png().toBuffer();
const insideImage=await sharp({create:{width:160,height:120,channels:3,background:'#276f8c'}}).png().toBuffer();
async function fixtures(page,{theme='light',stale=false}={}) {
  const errors=[],writes=[],imagePaths=[];
  const binder={id:binderId,title:'My outside cover',description:'Independent cover and pages',binder_type:'collection',game:'pokemon',
    color:'#573882',columns:3,rows:3,page_count:1,revision:1,slots:[],filled:0,
    appearance:{mode:'image',background_color:'#234567',wallpaper_dim:0},wallpaper_version:insideVersion,cover_wallpaper_version:null};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(value=>localStorage.setItem('cardshelf.theme',value),theme);
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;let data;
    if(path.endsWith('/cover-wallpaper')||path.endsWith('/wallpaper')) {
      imagePaths.push(path);return route.fulfill({contentType:'image/png',body:path.endsWith('/cover-wallpaper')?coverImage:insideImage});
    }
    if(path===`/api/binders/${binderId}/appearance`&&req.method()==='PATCH') {
      const body=req.postDataJSON();writes.push(body);
      if(stale&&writes.length===1) {
        binder.revision++;binder.color='#998877';
        return route.fulfill({status:409,json:{message:'This binder changed in another session. Reopen Appearance before saving.'}});
      }
      binder.appearance=body.appearance;binder.color=body.cover_color;binder.revision++;
      if(body.cover_wallpaper)binder.cover_wallpaper_version=coverVersion;
      if(body.remove_cover_wallpaper)binder.cover_wallpaper_version=null;
      if(body.remove_wallpaper)binder.wallpaper_version=null;
      data=binder;
    }
    else if(path==='/api/session')data={user:{id:'cover-fixture',name:'Collector',role:'user'},setup_required:false};
    else if(path==='/api/account/games')data={tier:'complimentary',games:[{code:'pokemon',manageable:true}]};
    else if(path==='/api/account/membership')data={access:{tier:'complimentary',features:[],allowed:true}};
    else if(path==='/api/binders/'+binderId||path==='/api/shared/'+shareToken)data=binder;
    else if(path==='/api/binders')data=[binder];
    else if(path==='/api/dashboard')data={counts:{binders:1},binders:[binder],progress:[]};
    else if(path==='/api/prices/summary')data={enabled:false,rates:[],valuation:{aud_total:null,quantity:0,priced_quantity:0,unpriced_quantity:0,stale_quantity:0,fx_missing_quantity:0}};
    else if(path==='/api/public/affiliate-shops')data={shops:[]};
    else if(path.startsWith('/api/ads/'))data={eligible:false};
    else if(path==='/api/public/platform')data={};
    else return route.fulfill({status:404,json:{message:'Unexpected fixture '+path}});
    return route.fulfill({json:data});
  });
  return {binder,writes,errors,imagePaths};
}
async function open(page){await page.goto('/binders/'+binderId);await page.getByRole('button',{name:'Appearance',exact:true}).click();}
async function outside(page){await page.getByRole('button',{name:'Outside cover',exact:true}).click();}
async function chooseCover(page){
  await page.getByLabel('Cover background',{exact:false}).selectOption('image');
  await page.getByLabel('Cover wallpaper image',{exact:false}).setInputFiles({name:'cover.png',mimeType:'image/png',buffer:coverImage});
  await expect(page.getByText('Selected: cover.png',{exact:true})).toBeVisible();
}
async function fits(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
for(const theme of ['light','dark'])test(theme+' outside cover preview saves and appears on shelf, overview and sharing',async({page},info)=>{
  const state=await fixtures(page,{theme});await open(page);await outside(page);
  // Native colour pickers are OS dialogs; dispatch the input they produce.
  await page.getByRole('dialog',{name:'Binder appearance'}).getByLabel('Cover colour',{exact:true}).evaluate(input=>{input.value='#e6cc7a';input.dispatchEvent(new Event('input',{bubbles:true}));});await chooseCover(page);
  await page.getByLabel('Image fit',{exact:false}).selectOption('contain');
  const preview=page.locator('.appearance-cover-preview');
  await expect(preview.locator('.binder-wallpaper-image')).toHaveCSS('background-size','contain');
  await expect(preview.locator('.binder-wallpaper-layer')).toHaveCSS('background-color','rgb(230, 204, 122)');
  await fits(page);await preview.screenshot({path:info.outputPath(theme+'-cover-preview.png')});
  await page.getByRole('button',{name:'Inside pages',exact:true}).click();
  await expect(page.getByLabel('Background colour',{exact:true})).toHaveValue('#234567');
  await expect(page.locator('.appearance-preview .binder-wallpaper-image')).toHaveCSS('background-image',new RegExp('/wallpaper'));
  await outside(page);await expect(page.getByText('Selected: cover.png',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.writes).toHaveLength(1);expect(state.writes[0].appearance.mode).toBe('image');
  expect(state.writes[0].appearance.background_color).toBe('#234567');expect(state.writes[0].cover_color).toBe('#e6cc7a');
  expect(state.writes[0].wallpaper).toBeUndefined();expect(state.writes[0].cover_wallpaper.data_base64).toBe(coverImage.toString('base64'));
  for(const route of ['/binders','/app','/shared/'+shareToken]) {
    if(route.startsWith('/shared/'))state.imagePaths.length=0;
    await page.goto(route);await expect(page.locator('.binder-cover .binder-wallpaper-image')).toHaveCSS('background-image',/cover-wallpaper/);await fits(page);
  }
  expect(state.imagePaths).toContain(`/api/shared/${shareToken}/cover-wallpaper`);
  expect(state.imagePaths).toContain(`/api/shared/${shareToken}/wallpaper`);
  expect(state.imagePaths.some(path=>path.startsWith('/api/binders/'))).toBe(false);
  expect(state.errors).toEqual([]);
});
test('cancel discards a cover upload and removal saves only the selected surface',async({page})=>{
  const state=await fixtures(page);await open(page);await outside(page);await chooseCover(page);
  await page.getByRole('button',{name:'Close dialog'}).click();expect(state.writes).toEqual([]);
  await page.getByRole('button',{name:'Appearance',exact:true}).click();await outside(page);
  await expect(page.getByLabel('Cover background',{exact:false})).toHaveValue('color');
  await expect(page.getByText('Selected: cover.png',{exact:true})).toHaveCount(0);
  await chooseCover(page);await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Appearance',exact:true}).click();await outside(page);
  await page.getByRole('button',{name:'Remove cover wallpaper on save',exact:true}).click();
  await expect(page.locator('.appearance-cover-preview .binder-wallpaper-image')).toHaveCount(0);
  await page.getByRole('button',{name:'Inside pages',exact:true}).click();
  await expect(page.locator('.appearance-preview .binder-wallpaper-image')).toHaveCount(1);
  await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.writes[1].remove_cover_wallpaper).toBe(true);expect(state.writes[1].remove_wallpaper).toBe(false);
  expect(state.binder.wallpaper_version).toBe(insideVersion);expect(state.binder.cover_wallpaper_version).toBeNull();expect(state.errors).toEqual([]);
});
test('conflicting edits require a reload and discard the unsaved cover image',async({page})=>{
  const state=await fixtures(page,{stale:true});await open(page);await outside(page);await chooseCover(page);
  await page.getByRole('button',{name:'Save appearance',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save appearance',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Reload appearance',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Binder appearance'}).getByLabel('Cover colour',{exact:true})).toHaveValue('#998877');
  await expect(page.getByText('Selected: cover.png',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Save appearance',exact:true})).toBeEnabled();
  expect(state.errors).toEqual([]);
});
