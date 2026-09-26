import {test,expect} from '@playwright/test';
import {SCAN_DEFAULTS} from '../../shared/card-scanning.mjs';
const shop={id:'00000000-0000-0000-0000-000000000001',name:'Card binders',retailer:'amazon',description:'Keep your collection organised.',url:'https://www.amazon.com.au/dp/ABCDEFGHIJ?tag=fixture-22',enabled:true,placements:['marketplace'],games:[],expires_on:''};
const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="336"><rect width="240" height="336" rx="12" fill="#568378"/><text x="120" y="180" text-anchor="middle" fill="white" font-size="24">Test card</text></svg>');
const card={id:'en:base1-4',game:'pokemon',name:'Charizard',set_name:'Base Set',local_id:'4',language:'en',rarity:'Rare',faces:[],rules_text:'Fixture card',image_url:photo,printings:[]};
const offer=(plan,cadence)=>({plan_code:plan,cadence,total_minor:cadence==='MONTHLY'?1000:10000,tax_minor:0,tax_mode:'none',tax_behavior:'inclusive',product_snapshot:{id:'prod_'+plan,name:plan==='plus'?'Collector Pro':'Collector',description:'Tools for your collection.',images:[],marketing_features:[{name:'Ad-free collecting'}]}});
async function fixtures(page,mode='system'){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(value=>{if(!localStorage.getItem('cardshelf.theme'))localStorage.setItem('cardshelf.theme',value)},mode);
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let data;
    if(path==='/api/session')data={user:{id:'theme-fixture',name:'Theme tester',role:'admin'},setup_required:false};
    else if(path==='/api/admin/affiliate-shops')data={enabled:true,shops:[shop],revision:1};
    else if(path==='/api/public/affiliate-shops')data={shops:[shop]};
    else if(path==='/api/marketplace/listings')data={items:[{...card,id:'fixture',card_name:card.name,photos:[{url:photo}],printing_label:'Normal',condition:'NM',status:'active',price_minor:100,seller_alias:'Collector',region:'Perth'}],total:1};
    else if(path==='/api/marketplace/access')data={can_sell:true,can_enquire:true};
    else if(path==='/api/admin/platform/plans')data=[];
    else if(path==='/api/admin/integrations/stripe/products')data={configured:false,settings:{managed:false,daily:false,mirror_plans:false,revision:1},products:[],offers:[]};
    else if(path==='/api/admin/integrations/stripe/products/preview')data={preview:true,environment:'sandbox',checkout_enabled:false,last_synced_at:null,sync_failed:false,offers:['collector','plus'].flatMap(plan=>['MONTHLY','ANNUAL'].map(c=>offer(plan,c))),scan_allowances:{free:5,collector:25,plus:0}};
    else if(path==='/api/public/subscription-offers')data={enabled:false,offers:[],scan_allowances:{free:5,collector:25,plus:0}};
    else if(path==='/api/public/catalogue')data={items:[card],total:1,limit:24};
    else if(path==='/api/public/catalogue/sets')data=[];
    else if(path==='/api/admin/scanning')data={settings:{...SCAN_DEFAULTS,revision:1,enabled:false,api_key_set:false,key_available:true,monthly_budget_micros:0,tier_monthly_limits:{free:100,collector:100,plus:100,complimentary:100},input_price_micros:400000,output_price_micros:1600000},totals:{accounted_micros:0,confirmed:0,measured_micros:0,scans:0,uncertain:0},models:[],history:[],users:[]};
    else if(path==='/api/account/games')data={tier:'complimentary'};
    else if(path==='/api/account/membership')data={access:{tier:'complimentary',features:[],allowed:true}};
    else if(path.startsWith('/api/ads/'))data={eligible:false};
    else if(path==='/api/public/platform')data={};
    else return route.fulfill({status:404,json:{message:'Unexpected fixture path '+path}});
    return route.fulfill({json:data});
  });return errors;
}
// Resolve painted solid backgrounds, including translucent headers, instead of
// asserting token names. This catches scoped rules that override the palette.
async function colours(locator){
  return locator.evaluate(el=>{
    const rgb=value=>{const n=value.match(/[\d.]+/g)?.map(Number)||[];return [n[0]||0,n[1]||0,n[2]||0,n[3]??1]};
    const blend=(top,bottom)=>top.slice(0,3).map((n,i)=>n*top[3]+bottom[i]*(1-top[3]));
    const layers=[];for(let node=el;node;node=node.parentElement)layers.push(rgb(getComputedStyle(node).backgroundColor));
    let background=[255,255,255];for(const layer of layers.reverse())background=blend(layer,background);
    const foreground=blend(rgb(getComputedStyle(el).color),background);
    const luminance=colour=>colour.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
    const a=luminance(foreground),b=luminance(background);
    return {contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),background:b};
  });
}
async function readable(page,selectors){
  for(const selector of selectors){const locator=page.locator(selector).first();await expect(locator).toBeVisible();expect((await colours(locator)).contrast,selector+' text contrast').toBeGreaterThanOrEqual(4.5);}
}
async function surface(page,selector,mode){
  const locator=page.locator(selector).first();await expect(locator).toBeVisible();const {background}=await colours(locator);
  if(mode==='dark')expect(background,selector+' dark surface').toBeLessThan(.1);else expect(background,selector+' light surface').toBeGreaterThan(.75);
}
async function fits(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal page overflow').toBe(true);}
for(const mode of ['light','dark']){
  test(mode+' public pages keep readable surfaces, controls and pricing',async({page},info)=>{
    const errors=await fixtures(page,mode);await page.emulateMedia({colorScheme:mode});
    for(const [url,panel,selectors] of [
      ['/','.m-feature-card',['.m-lead','.m-feature-card p','.m-footer p']],
      ['/pricing','[data-testid="free-plan"]',['.m-lead','[data-testid="free-plan"] h2','[data-testid="free-plan"] .m-button']],
      ['/early-access','.m-form-card',['.m-form-card h2','.m-form-card label','.m-form-card input','.m-form-card .m-button']],
      ['/explore','.public-card-tile',['.catalogue-heading p','.public-card-tile small','.catalogue-search input']]
    ]){
      await page.goto(url);await expect(page.locator('html')).toHaveAttribute('data-theme',mode);await surface(page,panel,mode);await readable(page,selectors);await fits(page);
      await page.screenshot({path:info.outputPath(mode+url.replaceAll('/','-')+'public.png'),fullPage:true});
    }expect(errors).toEqual([]);
  });
  test(mode+' marketplace and administration share the palette',async({page},info)=>{
    const errors=await fixtures(page,mode);await page.emulateMedia({colorScheme:mode});
    for(const [url,panel,selectors] of [
      ['/marketplace','.market-card',['.market-card-copy h2','.market-card-copy p','.market-card-footer','[data-testid="amazon-disclosure"]','[data-market-affiliate] a','[data-market-affiliate] h2','[data-market-affiliate] .affiliate-label','.market-filters input']],
      ['/admin','.admin-card',['.admin-card h3','.admin-card p','.admin-search input']],
      ['/admin/affiliate-shops','.affiliate-section',['.affiliate-section h2','.affiliate-section .data-note','.affiliate-section .alert','input[type="url"]']],
      ['/admin/pricing','.settings-panel',['.settings-panel h2','.settings-panel .muted','.button.primary']],
      ['/admin/scanning','.scan-admin-panel',['.scan-admin-panel .muted','.scan-admin-panel input','.scan-admin-panel .alert.info']],
      ['/admin/integrations/stripe-preview','.stripe-plan',['.stripe-description','.billing-cadence button[aria-pressed="true"]','.stripe-tax-note']]
    ]){
      await page.goto(url);await surface(page,panel,mode);await readable(page,selectors);await fits(page);
      if(url==='/admin/pricing'){await page.locator('.button.primary').first().hover();await readable(page,['.button.primary']);}
      if(url.endsWith('stripe-preview')){await surface(page,'.preview-banner',mode);await readable(page,['.preview-banner']);}
      if(url==='/marketplace'||url==='/admin'||url.endsWith('stripe-preview'))await page.screenshot({path:info.outputPath(mode+url.replaceAll('/','-')+'.png'),fullPage:true});
    }expect(errors).toEqual([]);
  });
}
test('theme selection persists across website/admin/reload and System follows the device',async({page},info)=>{
  const errors=await fixtures(page);await page.emulateMedia({colorScheme:'light'});await page.goto('/');
  if(info.project.name==='phone')await page.getByRole('button',{name:'Toggle navigation'}).click();
  await page.getByLabel('Colour theme').selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.goto('/admin');await surface(page,'.admin-card','dark');await page.reload();await surface(page,'.admin-card','dark');
  await page.getByRole('button',{name:'Open account and settings'}).filter({visible:true}).click();
  await surface(page,'.navigation-sheet','dark');await page.getByLabel('Colour theme').selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByLabel('Colour theme').selectOption('light');await page.emulateMedia({colorScheme:'light'});await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'Close navigation'}).click();await surface(page,'.admin-card','light');expect(errors).toEqual([]);
});
