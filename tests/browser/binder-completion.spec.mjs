import {test,expect} from '@playwright/test';
const binderId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const printing=(n)=>'bbbbbbbb-bbbb-4bbb-8bbb-'+String(n).padStart(12,'0');
const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="210"><rect width="150" height="210" rx="9" fill="#526f69"/><rect x="10" y="28" width="130" height="93" rx="5" fill="#cfe6cc"/><circle cx="77" cy="77" r="25" fill="#e3c64b"/><text x="75" y="166" font-size="12" text-anchor="middle" fill="white">Fixture card</text></svg>');
function fixtureData({type='collection',design=false,total=3,allowed=true}={}){
  return {binder:{id:binderId,title:'My Scarlet & Violet binder',binder_type:type,game:'pokemon',columns:3,rows:3,page_count:8,design_checklist:design},
    preview_token:'a'.repeat(64),progress:{total:72,completed:72-total,missing:total,missing_printings:total,percent:Math.round((72-total)/72*100)},
    permissions:{can_add_wishlist:allowed,can_browse_marketplace:true,wishlist_reason:allowed?'':'Saving a wishlist needs collection access.'},
    items:Array.from({length:total},(_,i)=>({printing_id:printing(i+1),card_id:'en:fixture-'+i,name:['Pikachu','Mew','Eevee'][i%3],local_id:String(i+1),label:i===0?'Reverse Holo':'Holo',language:'en',image_url:photo,set_name:'Scarlet & Violet',positions:i===0?[0,27]:[i],wishlist:i===1,owned_quantity:type==='tracking'&&i===0?2:0,match_count:i===0?2:0}))};
}
async function fixtures(page,options={}){
  let data=fixtureData(options);const calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(mode=>localStorage.setItem('cardshelf.theme',mode),options.theme||'light');
  await page.route('**/api/**',async route=>{
    const r=route.request(),path=new URL(r.url()).pathname;
    if(path.endsWith('/completion/wishlist')){
      const body=r.postDataJSON();calls.push(body);
      if(options.stale){data.items[0].wishlist=true;data.preview_token='b'.repeat(64);return route.fulfill({status:409,json:{message:'This binder or your collection changed. Refresh the missing cards and review your selection.'}});}
      for(const item of data.items)if(body.printing_ids.includes(item.printing_id))item.wishlist=true;
      data.preview_token='b'.repeat(64);return route.fulfill({json:{added:body.printing_ids.length,already_wishlisted:0}});
    }
    if(path.endsWith('/completion/matches'))return route.fulfill({json:{printing_id:printing(1),total:2,page:1,page_size:6,items:[
      {id:'listing-one',price_minor:250,condition:'NM',seller_alias:'Perth collector',postage_minor:150,delivery:'both',region:'Perth WA'},
      {id:'listing-two',price_minor:300,condition:'LP',seller_alias:'Local collector',postage_minor:0,delivery:'pickup',region:'Fremantle WA'}]}});
    if(path.endsWith('/completion'))return route.fulfill({json:data});
    if(path==='/api/session')return route.fulfill({json:{user:{id:'completion-fixture',name:'Collector',role:'user'},setup_required:false}});
    if(path==='/api/account/games')return route.fulfill({json:{tier:'complimentary'}});
    if(path==='/api/account/membership')return route.fulfill({json:{access:{tier:'complimentary',features:[],allowed:true}}});
    if(path.startsWith('/api/ads/'))return route.fulfill({json:{eligible:false}});
    return route.fulfill({status:404,json:{message:'Unexpected fixture '+path}});
  });return {calls,errors,setData(value){data=value}};
}
async function visit(page){await page.goto('/binders/complete/'+binderId);await expect(page.getByRole('heading',{name:'Complete this binder',exact:true})).toBeVisible();}
async function fits(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
for(const theme of ['light','dark'])test(theme+' completion supports wishlist selection and exact listing details',async({page},info)=>{
  const {calls,errors}=await fixtures(page,{theme});await visit(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await expect(page.locator('.completion-card')).toHaveCount(3);
  await expect(page.getByText('Page 1, pocket 1 · Page 4, pocket 1',{exact:true})).toBeVisible();await fits(page);
  await page.screenshot({path:info.outputPath(theme+'-completion.png'),fullPage:true});
  await page.getByRole('button',{name:'View 2 listings',exact:true}).click();const modal=page.getByRole('dialog',{name:'Matching member listings'});
  await expect(modal).toContainText('Reverse Holo');await expect(modal).toContainText('Near mint · Perth collector');await expect(modal).toContainText('$1.50 postage');await expect(modal).toContainText('Pickup only');
  await expect(modal.getByRole('link',{name:'View listing'}).first()).toHaveAttribute('href','/marketplace/listing-one');await fits(page);
  await page.screenshot({path:info.outputPath(theme+'-matches.png'),fullPage:true});await modal.getByRole('button',{name:'Close dialog'}).click();
  await page.getByLabel('Select Pikachu · Reverse Holo · EN',{exact:true}).check();
  await page.getByRole('button',{name:'Add selected to wishlist',exact:true}).click();await expect(page.getByRole('status')).toContainText('1 printing added');
  expect(calls).toEqual([{preview_token:'a'.repeat(64),printing_ids:[printing(1)],confirm_displayed_printings:false}]);
  await expect(page.locator('[data-printing="'+printing(1)+'"]')).toContainText('On your wishlist');expect(errors).toEqual([]);
});
test('selection covers filtered results across pages and preserves existing wishes',async({page})=>{
  const {calls}=await fixtures(page,{total:30});await visit(page);await expect(page.locator('.completion-card')).toHaveCount(24);
  await page.getByRole('button',{name:'Select all results',exact:true}).click();await expect(page.getByText('29 selected across all pages',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('.completion-card')).toHaveCount(6);await expect(page.locator('.completion-card input:checked')).toHaveCount(6);
  await page.getByRole('button',{name:'Clear selection',exact:true}).click();await page.getByLabel('Search missing cards',{exact:true}).fill('Pikachu');
  await page.getByRole('button',{name:'Select all results',exact:true}).click();await page.getByRole('button',{name:'Add selected to wishlist',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('10 printings added');expect(calls[0].printing_ids).toEqual(Array.from({length:10},(_,i)=>printing(i*3+1)));
});
test('stale bulk selection refreshes state and requires another explicit selection',async({page})=>{
  const {calls}=await fixtures(page,{stale:true});await visit(page);await page.getByRole('button',{name:'Select all results',exact:true}).click();
  await page.getByRole('button',{name:'Add selected to wishlist',exact:true}).click();await expect(page.getByRole('alert')).toContainText('changed');
  await expect(page.getByText('0 selected across all pages',{exact:true})).toBeVisible();await expect(page.locator('[data-printing="'+printing(1)+'"]')).toContainText('On your wishlist');
  await expect(page.getByRole('button',{name:'Add selected to wishlist',exact:true})).toBeDisabled();expect(calls).toHaveLength(1);
});
test('design Tracking checklists show independent marks and need displayed-printing consent',async({page})=>{
  const {calls}=await fixtures(page,{type:'tracking',design:true});await visit(page);
  await expect(page.getByText('You own this printing; this checklist is still unmarked.')).toBeVisible();
  await page.getByLabel('Select Pikachu · Reverse Holo · EN',{exact:true}).check();await expect(page.getByRole('button',{name:'Add selected to wishlist',exact:true})).toBeDisabled();
  await page.getByLabel('I want the exact displayed printings on my wishlist.').check();await page.getByRole('button',{name:'Add selected to wishlist',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('1 printing added');expect(calls[0].confirm_displayed_printings).toBe(true);
});
test('empty, completed and read-only states stay useful without enabled wishlist writes',async({page})=>{
  const state=await fixtures(page,{allowed:false});await visit(page);await expect(page.getByRole('button',{name:'Add selected to wishlist',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'View 2 listings',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Close dialog'}).click();
  state.setData(fixtureData({total:0}));await page.getByRole('button',{name:'Refresh missing cards'}).click();await expect(page.getByRole('heading',{name:'All planned cards accounted for'})).toBeVisible();
  const empty=fixtureData({total:0});empty.progress={total:0,completed:0,missing:0,missing_printings:0,percent:0};state.setData(empty);
  await page.getByRole('button',{name:'Refresh missing cards'}).click();await expect(page.getByRole('heading',{name:'No cards planned yet'})).toBeVisible();expect(state.calls).toEqual([]);
});
