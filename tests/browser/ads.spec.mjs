import {test,expect} from '@playwright/test';
async function fixtures(page,{blocked=false,rejectPreference=false,count=1,hidden=false}={}){
  let mode=hidden?'hidden':'preview';const requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/googlesyndication|doubleclick/.test(r.url()))requests.push(r.url());});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data={};
    if(path==='/api/session')data={user:{id:'admin-fixture',role:'admin',name:'Administrator'},setup_required:false,admin_placement_view:mode};
    else if(path==='/api/ads/adsense' && blocked)return route.abort('blockedbyclient');
    else if(path==='/api/ads/adsense')data=mode==='preview'?{eligible:false,placeholder:true,page_kind:'marketing',revision:1}:{eligible:false};
    else if(path==='/api/admin/adsense')data={enabled:false,verification_enabled:false,placeholders_enabled:true,publisher_id:'',slot_id:'',marketplace_slot_id:'',auto_ads_enabled:false,marketplace_enabled:false,revision:1,admin_view:mode};
    else if(path==='/api/admin/adsense/view'){if(!rejectPreference)mode=route.request().postDataJSON().mode;data={mode};}
    else if(path==='/api/public/catalogue')data={items:[{id:'en:demo-1',game:'pokemon',language:'en',name:'Test card',set_name:'Test set',local_id:'1'}],total:1,limit:24};
    else if(path==='/api/public/catalogue/sets')data=[];
    else if(path==='/api/catalogue')data={items:[{id:'en:demo-1',game:'pokemon',language:'en',name:'Test card',set_name:'Test set',local_id:'1',quantity:0,printings:[]}],total:1,limit:30};
    else if(path==='/api/marketplace/listings')data={items:[{id:'test-sale',photos:[{url:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'}],card_name:'Test card',set_name:'Test set',local_id:'1',printing_label:'Normal',condition:'NM',language:'en',status:'available',price_minor:100,seller_alias:'Test',region:'Test'}],total:1};
    else if(path==='/api/marketplace/access')data={can_sell:false,can_enquire:false};
    else if(path==='/api/catalogue/facets')data={sets:[],rarities:[]};
    else if(path==='/api/ads/sponsor')data={eligible:false};
    if(Array.isArray(data.items)){const sample=data.items[0];data.items=Array.from({length:count},(_,i)=>({...sample,id:sample.id+'-'+i}));data.total=count;}
    await route.fulfill({json:data});
  });
  return{requests,errors};
}
test('administrator previews a local responsive placement and can hide it',async({page})=>{
  const {requests,errors}=await fixtures(page);
  await page.goto('/');await expect(page.getByTestId('ad-placeholder')).toBeVisible();
  await page.getByTestId('ad-placeholder').scrollIntoViewIfNeeded();
  const bounds=await page.getByTestId('ad-placeholder').boundingBox();expect(bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:`test-results/ads/placeholder-${test.info().project.name}.png`});
  expect(requests).toEqual([]);
  await page.goto('/admin/adsense');await expect(page.getByRole('heading',{name:'Your administrator ad view'})).toBeVisible();
  await expect(page.getByTestId('ad-placeholder')).toHaveCount(0);
  await page.getByRole('combobox',{name:'Display in this browser'}).selectOption('hidden');
  await page.getByRole('button',{name:'Apply my ad view'}).click();
  await expect(page.getByRole('combobox',{name:'Display in this browser'})).toHaveValue('hidden');
  await page.getByRole('link',{name:'View homepage',exact:true}).click();
  await expect(page.getByTestId('ad-placeholder')).toHaveCount(0);expect(requests).toEqual([]);expect(errors).toEqual([]);
});

test('local admin preview survives a blocked ad request and live-ad cosmetic filters',async({page})=>{
  const {requests,errors}=await fixtures(page,{blocked:true});
  await page.addInitScript(()=>{
    const observer=new MutationObserver(()=>{
      if(!document.head||document.getElementById('synthetic-ad-filter'))return;
      const style=document.createElement('style');style.id='synthetic-ad-filter';
      style.textContent='.ad-placeholder,.adsense-slot,.adsbygoogle{display:none!important}';document.head.append(style);
    });observer.observe(document,{childList:true,subtree:true});
  });
  await page.goto('/');await expect(page.getByTestId('ad-placeholder')).toBeVisible();
  await page.goto('/features');await expect(page.getByTestId('ad-placeholder')).toBeVisible();
  await page.goto('/admin/adsense');await expect(page.getByTestId('ad-placeholder')).toHaveCount(0);
  expect(requests).toEqual([]);expect(errors).toEqual([]);
});
test('a rejected preference shows a recoverable error instead of silently reloading',async({page})=>{
  await fixtures(page,{rejectPreference:true});await page.goto('/admin/adsense');
  await page.getByRole('combobox',{name:'Display in this browser'}).selectOption('hidden');
  await page.getByRole('button',{name:'Apply my ad view'}).click();
  await expect(page.getByRole('alert')).toContainText('did not retain the preview setting');
  await expect(page.getByRole('button',{name:'Apply my ad view'})).toBeEnabled();
});

test('Auto formats adapt across relevant pages without overflow or live requests',async({page})=>{
  const {requests,errors}=await fixtures(page,{blocked:true});
  for(const [path,format] of [['/','billboard'],['/features','multiplex'],['/pricing','rectangle'],['/explore','rectangle'],['/cards','rectangle'],['/marketplace','rectangle']]){
    await page.goto(path);const placement=page.getByTestId('ad-placeholder');
    await expect(placement).toHaveAttribute('data-format',format);await expect(placement).toBeVisible();
    const box=await placement.boundingBox();expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(path==='/features'){
      expect(await page.locator('.multiplex-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(page.viewportSize().width<768?2:4);
      await placement.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/ads/multiplex-${test.info().project.name}.png`});
    }
    if(path==='/cards'){
      await page.getByRole('button',{name:'List view',exact:true}).click();await expect(placement).toHaveAttribute('data-format','leaderboard');
    }
    if(path==='/cards' && page.viewportSize().width<768){
      const anchor=await page.getByTestId('placement-anchor').boundingBox(),nav=await page.locator('.mobile-nav').boundingBox();expect(anchor.y+anchor.height).toBeLessThanOrEqual(nav.y);
    }
    if(['/', '/features', '/cards'].includes(path)){
      await page.getByRole('button',{name:'Dismiss anchor preview'}).click();await expect(page.getByTestId('placement-anchor')).toHaveCount(0);
    }
  }
  await page.goto('/admin/adsense');await expect(page.getByTestId('placement-anchor')).toHaveCount(0);await expect(page.getByTestId('ad-placeholder')).toHaveCount(0);
  expect(requests).toEqual([]);expect(errors).toEqual([]);
});
test('side rail uses only the unused widescreen margin and can be dismissed',async({page})=>{
  await fixtures(page,{blocked:true});await page.setViewportSize({width:1920,height:1080});await page.goto('/features');
  const rail=page.getByTestId('placement-rail');await expect(rail).toBeVisible();
  const box=await rail.boundingBox();expect(box.width).toBe(160);expect(box.height).toBe(600);
  const content=await page.locator('.m-feature-details').boundingBox();expect(box.x).toBeGreaterThanOrEqual(content.x+content.width);
  await page.screenshot({path:`test-results/ads/rail-${test.info().project.name}.png`});
  await page.getByRole('button',{name:'Dismiss side rail preview'}).click();await expect(rail).toHaveCount(0);
  await page.goto('/');await page.setViewportSize({width:1024,height:768});await expect(page.getByTestId('placement-rail')).toBeHidden();
});

test('catalogue and marketplace grid previews follow six cards without replacing records',async({page})=>{
  const {requests,errors}=await fixtures(page,{count:8,blocked:true});
  for(const [path,gridSelector,cardSelector] of [['/explore','.public-card-grid','.public-card-tile'],['/cards','.card-grid','.card-tile'],['/marketplace','.market-grid','a.market-card']]){
    await page.goto(path);const grid=page.locator(gridSelector),placement=grid.getByTestId('ad-placeholder');
    await expect(grid.locator(cardSelector)).toHaveCount(8);await expect(placement).toHaveCount(1);
    await expect(grid.locator(':scope > *').nth(6)).toHaveAttribute('data-testid','ad-placeholder');
    await expect(placement).toHaveAttribute('data-format','rectangle');
    expect(await placement.locator('a,button').count()).toBe(0);
    const box=await placement.boundingBox(),card=await grid.locator(cardSelector).first().boundingBox();expect(Math.abs(box.width-card.width)).toBeLessThan(2);
    await placement.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/ads/grid-${path.slice(1)}-${test.info().project.name}.png`});
    if(path==='/cards'){
      await expect(page.getByText('8 matching cards',{exact:true})).toBeVisible();
      await page.getByRole('button',{name:'List view',exact:true}).click();await expect(page.getByTestId('ad-placeholder')).toHaveCount(1);
      await page.getByRole('button',{name:'Grid view',exact:true}).click();await expect(grid.getByTestId('ad-placeholder')).toHaveCount(1);
    }
  }
  await page.goto('/marketplace?mine=1');await expect(page.getByTestId('ad-placeholder')).toHaveCount(0);
  expect(requests).toEqual([]);expect(errors).toEqual([]);
});
for(const options of [{count:0},{count:8,hidden:true}])test('empty or hidden grids have no preview '+JSON.stringify(options),async({page})=>{
  await fixtures(page,options);
  for(const path of ['/explore','/cards','/marketplace']){
    await page.goto(path);await expect(page.getByTestId('ad-placeholder')).toHaveCount(0);
    await expect(page.locator('.grid-placement')).toHaveCount(0);
  }
});
