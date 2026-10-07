import {test,expect} from '@playwright/test';
const offer=(plan,cadence)=>({plan_code:plan,cadence,total_minor:cadence==='MONTHLY'?1000:10000,tax_minor:0,tax_mode:'none',tax_behavior:'inclusive',product_snapshot:{id:'prod_'+plan,name:plan==='plus'?'Collector Pro':'Collector',description:'Tools for your collection.',images:[],marketing_features:[{name:'Ad-free collecting'}]}});
async function fixtures(page,{empty=false,role='admin',stripeOffers=[]}={}){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data;
    if(path==='/api/session')data={user:{id:'pricing-fixture',name:'Pricing tester',role},setup_required:false};
    else if(path==='/api/admin/integrations/stripe/controls')data={policy:{environment:'sandbox',requested_enabled:false,enabled:false,enforce:false,revision:1},impact:{protected:1,without_live_access:0},environments:[]};
    else if(path==='/api/admin/integrations/stripe/status')data={configured:true,key_available:true,portal_id:'bpc_fixture',accepting_new:false,active_environment:'sandbox',revision:1,offers:stripeOffers,events:[],subscriptions:[]};
    else if(path==='/api/admin/platform/plans')data=[];
    else if(path==='/api/admin/integrations/stripe/products')data={configured:false,settings:{managed:false,daily:false,mirror_plans:false,revision:1},products:[],offers:[]};
    else if(path==='/api/account/games')data={tier:'complimentary'};
    else if(path==='/api/admin/integrations/stripe/products/preview')data={preview:true,environment:'sandbox',checkout_enabled:false,last_synced_at:null,sync_failed:false,offers:empty?[]:['collector','plus'].flatMap(plan=>['MONTHLY','ANNUAL'].map(c=>offer(plan,c))),scan_allowances:{free:5,collector:25,plus:0}};
    else if(path==='/api/public/subscription-offers')data={enabled:false,offers:[],scan_allowances:{free:5,collector:25,plus:0}};
    else if(path==='/api/account/membership')data={access:{tier:'complimentary',features:[],allowed:true}};
    else if(path.startsWith('/api/ads/'))data={eligible:false};
    else return route.fulfill({status:404,json:{message:'Unexpected fixture path '+path}});
    return route.fulfill({json:data});
  });return errors;
}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
test('Free appears alongside Test plans for both cadences without checkout',async({page},info)=>{
  const errors=await fixtures(page);await page.goto('/admin/integrations/stripe-preview');
  await expect(page.locator('.stripe-plan-grid > article')).toHaveCount(3);
  await expect(page.getByTestId('free-plan')).toContainText('$0');
  await expect(page.getByTestId('free-plan')).toContainText('forever');
  await expect(page.getByText('Unlimited photo scans',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Yearly',exact:true}).click();
  await expect(page.getByTestId('free-plan')).toContainText('$0');
  await expect(page.getByRole('link',{name:/Choose Collector/})).toHaveCount(0);
  await noOverflow(page);await page.screenshot({path:info.outputPath('free-test-pricing.png'),fullPage:true});expect(errors).toEqual([]);
});
test('an empty Test catalogue still previews Free and public paused pricing includes it once',async({page})=>{
  const errors=await fixtures(page,{empty:true});await page.goto('/admin/integrations/stripe-preview');
  await expect(page.getByTestId('free-plan')).toBeVisible();
  await expect(page.getByRole('heading',{name:'No Test prices to preview yet.'})).toBeVisible();
  await expect(page.locator('.stripe-plan-grid > article')).toHaveCount(1);
  await page.getByRole('link',{name:'View public pricing',exact:true}).click();
  await expect(page.getByTestId('free-plan')).toHaveCount(1);
  await expect(page.getByRole('link',{name:'Browse for free',exact:true})).toBeVisible();
  await noOverflow(page);expect(errors).toEqual([]);
});
test('administration tools are grouped, searchable and reachable through the section switcher',async({page},info)=>{
  const errors=await fixtures(page);await page.goto('/admin');
  await expect(page.getByRole('heading',{name:'Manage your platform.'})).toBeVisible();
  await expect(page.locator('.admin-card')).toHaveCount(15);
  await page.getByLabel('Find an admin tool').fill('scan');
  await expect(page.locator('.admin-card')).toHaveCount(1);
  await expect(page.locator('.admin-card')).toContainText('Card scanning');
  await page.getByLabel('Find an admin tool').fill('');
  await noOverflow(page);await page.screenshot({path:info.outputPath('admin-home.png'),fullPage:true});
  await page.getByLabel('Go to admin section').selectOption('/admin/pricing');
  await expect(page.getByRole('heading',{name:'Pricing & plans',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Free · $0 forever',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Manage it once. Keep it in sync.',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Test pricing preview',exact:true}).first().click();
  await expect(page.getByTestId('free-plan')).toBeVisible();expect(errors).toEqual([]);
});
test('non-admin users cannot open the administration home',async({page})=>{
  await fixtures(page,{role:'user'});await page.goto('/admin');
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading',{name:'Manage your platform.'})).toHaveCount(0);
});
test('an incorrect draft can be cancelled or deleted in the selected Stripe environment',async({page},info)=>{
  const draft={...offer('collector','MONTHLY'),id:'draft-offer',price_id:'price_collector_plus',revision:1,published:false,can_delete:true};
  const offers=[draft,{...draft,id:'published-offer',price_id:'price_published',published:true,can_delete:false},
    {...draft,id:'used-offer',price_id:'price_used',can_delete:false},{...draft,id:'managed-offer',price_id:'price_managed',sync_managed:true,can_delete:false}];
  const errors=await fixtures(page,{stripeOffers:offers}),requests=[];
  await page.route('**/api/admin/integrations/stripe/offers/*/delete?*',async route=>{
    requests.push({method:route.request().method(),environment:new URL(route.request().url()).searchParams.get('environment'),body:route.request().postDataJSON()});
    offers.splice(offers.findIndex(o=>o.id===draft.id),1);
    return route.fulfill({json:{deleted:true}});
  });
  await page.goto('/admin/integrations/stripe');
  await page.getByRole('combobox',{name:'Stripe credential environment',exact:true}).selectOption('production');
  const button=page.getByRole('button',{name:'Delete draft',exact:true});
  await expect(button).toHaveCount(1);
  page.once('dialog',dialog=>dialog.dismiss());await button.click();
  await expect(button).toBeVisible();expect(requests).toHaveLength(0);
  await button.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('stripe-delete-draft.png')});
  page.once('dialog',dialog=>{expect(dialog.message()).toContain('Collector');expect(dialog.message()).toContain('price_collector_plus');return dialog.accept();});
  await button.click();
  await expect(page.getByRole('status')).toContainText('Draft offer deleted. You can now add its Stripe price with the correct tier.');
  await expect(page.getByRole('cell',{name:'price_collector_plus',exact:true})).toHaveCount(0);
  await expect(page.getByRole('cell',{name:'price_published',exact:true})).toBeVisible();
  expect(requests).toEqual([{method:'POST',environment:'production',body:{revision:1,confirm:true}}]);
  await noOverflow(page);expect(errors).toEqual([]);
});
test('a rejected deletion keeps the draft visible with the server explanation',async({page})=>{
  const errors=await fixtures(page,{stripeOffers:[{...offer('collector','MONTHLY'),id:'stale-draft',price_id:'price_stale',revision:1,published:false,can_delete:true}]});
  await page.route('**/api/admin/integrations/stripe/offers/*/delete?*',route=>route.fulfill({status:409,json:{statusCode:409,message:'Offer changed. Reload.'}}));
  await page.goto('/admin/integrations/stripe');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete draft',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Offer changed. Reload.');
  await expect(page.getByRole('cell',{name:'price_stale',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Delete draft',exact:true})).toBeEnabled();
  expect(errors).toEqual([]);
});
