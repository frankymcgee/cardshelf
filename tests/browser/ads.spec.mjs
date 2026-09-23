import {test,expect} from '@playwright/test';
async function fixtures(page){
  let mode='preview';const requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/googlesyndication|doubleclick/.test(r.url()))requests.push(r.url());});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data={};
    if(path==='/api/session')data={user:{id:'admin-fixture',role:'admin',name:'Administrator'},setup_required:false};
    else if(path==='/api/ads/adsense')data=mode==='preview'?{eligible:false,placeholder:true,page_kind:'marketing',revision:1}:{eligible:false};
    else if(path==='/api/admin/adsense')data={enabled:false,verification_enabled:false,placeholders_enabled:true,publisher_id:'',slot_id:'',marketplace_slot_id:'',auto_ads_enabled:false,marketplace_enabled:false,revision:1,admin_view:mode};
    else if(path==='/api/admin/adsense/view'){mode=route.request().postDataJSON().mode;data={mode};}
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
