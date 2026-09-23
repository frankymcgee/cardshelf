import {test,expect} from '@playwright/test';
async function fixtures(page,{blocked=false,rejectPreference=false}={}){
  let mode='preview';const requests=[],errors=[];
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
    else if(path==='/api/ads/sponsor')data={eligible:false};
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
