import {test,expect} from '@playwright/test';
const offer=(plan,cadence)=>({plan_code:plan,cadence,total_minor:cadence==='MONTHLY'?1000:10000,tax_minor:0,tax_mode:'none',tax_behavior:'inclusive',product_snapshot:{id:'prod_'+plan,name:plan==='plus'?'Collector Pro':'Collector',description:'Tools for your collection.',images:[],marketing_features:[{name:'Ad-free collecting'}]}});
async function fixtures(page,{empty=false,role='admin',stripeOffers=[],stripeManaged=false,pricingOffers=null,scanAllowances={free:5,collector:25,plus:0}}={}){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data;
    if(path==='/api/session')data={user:{id:'pricing-fixture',name:'Pricing tester',role},setup_required:false};
    else if(path==='/api/admin/integrations/stripe/controls')data={policy:{environment:'sandbox',requested_enabled:false,enabled:false,enforce:false,revision:1},impact:{protected:1,without_live_access:0},environments:[]};
    else if(path==='/api/admin/integrations/stripe/status')data={configured:true,key_available:true,portal_id:'bpc_fixture',accepting_new:false,active_environment:'sandbox',revision:1,product_sync_managed:stripeManaged,offers:stripeOffers.map(o=>({can_pause:o.published,can_publish:!o.published,...o})),events:[],subscriptions:[]};
    else if(path==='/api/admin/platform/plans')data=[];
    else if(path==='/api/admin/integrations/stripe/products')data={configured:false,settings:{managed:false,daily:false,mirror_plans:false,revision:1},products:[],offers:[]};
    else if(path==='/api/account/games')data={tier:'complimentary'};
    else if(path==='/api/admin/integrations/stripe/products/preview')data={preview:true,environment:'sandbox',checkout_enabled:false,last_synced_at:null,sync_failed:false,offers:empty?[]:pricingOffers??['collector','plus'].flatMap(plan=>['MONTHLY','ANNUAL'].map(c=>offer(plan,c))),scan_allowances:scanAllowances};
    else if(path==='/api/public/subscription-offers')data={enabled:!!pricingOffers,environment:'production',offers:pricingOffers??[],scan_allowances:scanAllowances};
    else if(path==='/api/billing/stripe/account')data={enabled:true,configured:true,environment:'production',offers:pricingOffers??[],subscriptions:[],scan_allowances:scanAllowances};
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
test('Stripe-managed mode permits manual cleanup and explains protected offers',async({page},info)=>{
  const draft={...offer('collector','MONTHLY'),id:'manual-draft',price_id:'price_manual_draft',revision:1,published:false,sync_managed:false,can_delete:true,can_pause:false,can_publish:false};
  const manual={...draft,id:'manual-published',price_id:'price_manual_published',published:true,can_delete:false,can_pause:true,delete_block_reason:'Pause this offer before deleting it.'};
  const managed={...manual,id:'stripe-published',price_id:'price_from_stripe',sync_managed:true,can_pause:false,delete_block_reason:'Managed by Stripe. Change the product or price in Stripe, then sync in Pricing & plans.'};
  const used={...draft,id:'used-draft',price_id:'price_used',can_delete:false,delete_block_reason:'Kept because this offer has checkout or subscription history.'};
  const offers=[draft,manual,managed,used],requests=[];
  const errors=await fixtures(page,{stripeOffers:offers,stripeManaged:true});
  await page.route('**/api/admin/integrations/stripe/offers/*?*',async route=>{
    requests.push({path:new URL(route.request().url()).pathname,environment:new URL(route.request().url()).searchParams.get('environment'),body:route.request().postDataJSON()});
    Object.assign(manual,{published:false,revision:2,can_pause:false,can_delete:true,delete_block_reason:''});
    return route.fulfill({json:{saved:true}});
  });
  await page.route('**/api/admin/integrations/stripe/offers/*/delete?*',async route=>{
    requests.push({path:new URL(route.request().url()).pathname,environment:new URL(route.request().url()).searchParams.get('environment'),body:route.request().postDataJSON()});
    offers.splice(offers.indexOf(draft),1);return route.fulfill({json:{deleted:true}});
  });
  await page.goto('/admin/integrations/stripe');
  await page.getByRole('combobox',{name:'Stripe credential environment',exact:true}).selectOption('production');
  await expect(page.getByText('Stripe manages new offers in this environment.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save draft offer',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Verify & publish',exact:true})).toHaveCount(0);
  const row=price=>page.getByRole('row').filter({has:page.getByRole('cell',{name:price,exact:true})});
  await expect(row('price_from_stripe').getByRole('button',{name:'Pause',exact:true})).toHaveCount(0);
  await expect(row('price_from_stripe')).toContainText('Managed by Stripe.');
  await expect(row('price_used')).toContainText('checkout or subscription history');
  await expect(row('price_used').getByRole('button',{name:'Delete draft',exact:true})).toHaveCount(0);
  await row('price_manual_published').getByRole('button',{name:'Pause',exact:true}).click();
  await expect(row('price_manual_published').getByRole('button',{name:'Delete draft',exact:true})).toBeVisible();
  page.once('dialog',dialog=>{expect(dialog.message()).toContain('Pricing & plans');return dialog.accept();});
  await row('price_manual_draft').getByRole('button',{name:'Delete draft',exact:true}).click();
  await expect(row('price_manual_draft')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Use Pricing & plans to sync this Stripe price under its correct tier.');
  expect(requests).toEqual([
    {path:'/api/admin/integrations/stripe/offers/manual-published',environment:'production',body:{revision:1,published:false,confirm_terms_reviewed:true}},
    {path:'/api/admin/integrations/stripe/offers/manual-draft/delete',environment:'production',body:{revision:1,confirm:true}}
  ]);
  await noOverflow(page);await page.screenshot({path:info.outputPath('stripe-managed-draft-cleanup.png'),fullPage:true});
  await page.getByRole('link',{name:'Open Pricing & plans',exact:true}).click();
  await expect(page).toHaveURL(/\/admin\/pricing\?environment=production#stripe-product-catalogue$/);
  await expect(page.getByRole('combobox',{name:'Stripe catalogue environment',exact:true})).toHaveValue('production');
  expect(errors).toEqual([]);
});

for(const view of ['Test preview','public pricing','membership'])test(view+' shows every backend tier allowance and zero as unlimited',async({page},info)=>{
  const pricingOffers=['collector','plus'].flatMap(plan=>['MONTHLY','ANNUAL'].map(c=>{
    const row=offer(plan,c);row.id=plan+'-'+c;row.terms='Synthetic recurring membership terms.';
    row.product_snapshot.marketing_features.push({name:'999 photo scans per month'});return row;
  }));
  const scanAllowances={free:5,collector:10,plus:100},errors=await fixtures(page,{pricingOffers,scanAllowances});
  const cases=[{free:5,collector:10,plus:100},{free:0,collector:10,plus:100},{free:5,collector:0,plus:100},{free:5,collector:10,plus:0}];
  for(const [index,limits] of cases.entries()){
    Object.assign(scanAllowances,limits);
    // Enter public pricing through client navigation so fixtures cover its API read.
    await page.goto(view==='membership'?'/membership':'/admin/integrations/stripe-preview');
    if(view==='public pricing')await page.getByRole('link',{name:'View public pricing',exact:true}).click();
    const card=name=>page.locator(view==='membership'?'.membership-product':'.stripe-plan').filter({has:page.getByText(name,{exact:true})});
    const expected=view==='membership'?[['collector','Collector'],['plus','Collector Pro']]:[['free','Free'],['collector','Collector'],['plus','Collector Pro']];
    async function checkAllowances(){
      for(const [tier,name] of expected){
        const amount=limits[tier]===0?'Unlimited photo scans':limits[tier]+' photo scans per month';
        await expect(card(name).getByText(amount,{exact:true})).toBeVisible();
        await expect(card(name).locator('.plan-scan-allowance')).toHaveCount(1);
        await expect(card(name).locator('.plan-scan-allowance')).toContainText('Requires collection access');
      }
    }
    await checkAllowances();
    await expect(page.getByText('999 photo scans per month',{exact:true})).toHaveCount(0);
    await expect(card('Collector Pro').getByText('Ad-free collecting',{exact:true})).toBeVisible();
    await expect(page.getByText('Photo scanning is not included in this tier.',{exact:true})).toHaveCount(0);
    if(view==='membership')await card('Collector Pro').getByRole('radio').last().check();
    else await page.getByRole('button',{name:'Yearly',exact:true}).click();
    await checkAllowances();await noOverflow(page);
    if(index===0||index===cases.length-1)await page.locator(view==='membership'?'.membership-products':'.stripe-plan-grid').screenshot({path:info.outputPath(index===0?'all-tier-photo-scans.png':'unlimited-photo-scans.png')});
  }
  expect(errors).toEqual([]);
});

test('an unavailable allowance never becomes unlimited or falls back to a Stripe scan count',async({page})=>{
  const row=offer('plus','MONTHLY');row.product_snapshot.marketing_features=[{name:'Unlimited photo scans'}];
  const errors=await fixtures(page,{pricingOffers:[row],scanAllowances:{free:5,collector:10}});
  await page.goto('/admin/integrations/stripe-preview');
  await expect(page.getByText('Photo scan allowance not available',{exact:true})).toBeVisible();
  await expect(page.getByText('Unlimited photo scans',{exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});

test('paused public pricing still shows all three saved allowances',async({page},info)=>{
  const errors=await fixtures(page,{scanAllowances:{free:5,collector:10,plus:0}});
  await page.goto('/admin/integrations/stripe-preview');
  await page.getByRole('link',{name:'View public pricing',exact:true}).click();
  await expect(page.getByTestId('free-plan').getByText('5 photo scans per month',{exact:true})).toBeVisible();
  const card=name=>page.locator('.stripe-plan').filter({has:page.getByRole('heading',{name,exact:true})});
  await expect(card('Collector').getByText('10 photo scans per month',{exact:true})).toBeVisible();
  await expect(card('Collector Plus').getByText('Unlimited photo scans',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:/Choose Collector/})).toHaveCount(0);
  await noOverflow(page);await page.locator('.stripe-plan-grid').screenshot({path:info.outputPath('paused-photo-scans.png')});expect(errors).toEqual([]);
});
