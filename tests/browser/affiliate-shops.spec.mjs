import {test,expect} from '@playwright/test';
import {AMAZON_STARTERS,AMAZON_DISCLOSURE} from '../../shared/affiliate-shops.mjs';
const shop=overrides=>({id:'00000000-0000-0000-0000-000000000001',name:'Example cards',description:'English cards and sealed packs',url:'https://shop.example.com/packs?ref=approved%2Bpartner',search_url:'https://shop.example.com/search?q={query}&ref=approved%2Bpartner',referral_code:'ISSUED-CODE',enabled:true,placements:['marketplace','cards','catalogue'],games:[],expires_on:'',...overrides});
const card={id:'en:base1-4',game:'pokemon',name:'Charizard & friends',set_name:'Base Set',local_id:'4',language:'en',rarity:'Rare',faces:[],rules_text:'Fixture card',image_url:'',printings:[]};
async function fixtures(page,{empty=false,failed=false,conflict=false,amazon=false}={}){
  const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
  let settings={enabled:false,shops:[],revision:1};
  await page.route('https://shop.example.com/**',route=>route.abort());
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let data;
    if(path==='/api/session')data={user:{id:'affiliate-fixture',name:'Affiliate tester',role:'admin'},setup_required:false};
    else if(path==='/api/admin/affiliate-shops'){
      if(route.request().method()==='POST'){
        const body=route.request().postDataJSON();posts.push(body);
        if(conflict)return route.fulfill({status:409,json:{message:'Affiliate settings changed. Reload before saving.'}});
        settings={enabled:body.enabled,shops:body.shops,revision:body.revision+1};
      }data=settings;
    }
    else if(path==='/api/public/affiliate-shops'){
      if(failed)return route.fulfill({status:503,json:{message:'Temporarily unavailable'}});
      data={shops:empty?[]:amazon?AMAZON_STARTERS.map((entry,i)=>shop({...entry,id:String(i),retailer:'amazon',url:'https://www.amazon.com.au/dp/ABCDEFGHIJ?tag=fixture-22',search_url:'',referral_code:''})):[shop(),shop({id:'00000000-0000-0000-0000-000000000002',name:'MTG only',games:['mtg']})]};
    }
    else if(path==='/api/marketplace/listings')data={items:[],total:0};
    else if(path==='/api/marketplace/access')data={can_sell:true,can_enquire:true};
    else if(path.startsWith('/api/public/catalogue/cards/'))data=path.endsWith('/prices')?{printings:[],references:[]}:card;
    else if(path==='/api/account/games')data={tier:'complimentary'};
    else if(path==='/api/account/membership')data={access:{tier:'complimentary',features:[],allowed:true}};
    else if(path.startsWith('/api/ads/'))data={eligible:false};
    else if(path==='/api/public/platform')data={};
    else return route.fulfill({status:404,json:{message:'Unexpected fixture path '+path}});
    return route.fulfill({json:data});
  });return {errors,posts};
}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
async function fillShop(page){
  await page.getByRole('button',{name:'Add shop',exact:true}).click();
  await page.getByLabel('Shop name',{exact:true}).fill('Example cards');
  await page.getByLabel('Description',{exact:true}).fill('English cards and sealed packs');
  await page.getByLabel('Affiliate shop URL',{exact:true}).fill(shop().url);
  await page.getByLabel('Optional affiliate search URL',{exact:true}).fill(shop().search_url);
  await page.getByLabel('Optional referral or coupon code').fill('ISSUED-CODE');
}
test('administrator previews and saves approved links with explicit enablement',async({page},info)=>{
  const {errors,posts}=await fixtures(page);await page.goto('/admin/affiliate-shops');
  await expect(page.getByLabel('Show affiliate shopping links')).not.toBeChecked();
  await fillShop(page);await expect(page.getByTestId('affiliate-shops')).toContainText('ISSUED-CODE');
  await expect(page.getByRole('link',{name:'Search Example cards (opens in a new tab)'})).toHaveAttribute('href',/q=Charizard%204%20Base%20Set%20English&ref=approved%2Bpartner/);
  expect(posts).toHaveLength(0);
  await page.getByLabel('Enable this shop').check();await page.getByLabel('Show affiliate shopping links').check();
  await noOverflow(page);await page.screenshot({path:info.outputPath('affiliate-admin.png'),fullPage:true});
  await page.getByLabel('Current administrator password').fill('Fixture password');
  await page.getByRole('button',{name:'Save affiliate shops',exact:true}).click();
  await expect(page.getByText('Affiliate shops saved.',{exact:true})).toBeVisible();
  expect(posts).toHaveLength(1);expect(posts[0].shops[0].url).toBe(shop().url);expect(posts[0].shops[0].enabled).toBe(true);expect(posts[0].enabled).toBe(true);
  await expect(page.getByLabel('Current administrator password')).toHaveValue('');expect(errors).toEqual([]);
});
test('marketplace search keeps attribution and private listings hide shopping links',async({page},info)=>{
  const {errors}=await fixtures(page);await page.goto('/marketplace');
  const panel=page.getByTestId('affiliate-shops');await expect(panel).toContainText('may earn a commission');
  const link=panel.getByRole('link',{name:'Visit Example cards (opens in a new tab)'});
  await expect(link).toHaveAttribute('href',shop().url);await expect(link).toHaveAttribute('rel','sponsored nofollow noopener');await expect(link).toHaveAttribute('target','_blank');
  await page.getByLabel('Search',{exact:true}).fill('English booster & box');
  await expect(panel.getByRole('link',{name:'Search Example cards (opens in a new tab)'})).toHaveAttribute('href','https://shop.example.com/search?q=English%20booster%20%26%20box&ref=approved%2Bpartner');
  await noOverflow(page);await page.screenshot({path:info.outputPath('affiliate-marketplace.png'),fullPage:true});
  await page.getByRole('link',{name:'My listings',exact:true}).click();await expect(panel).toHaveCount(0);expect(errors).toEqual([]);
});
test('public catalogue links use card identity and respect the game filter',async({page})=>{
  const {errors}=await fixtures(page);await page.goto('/explore/en%3Abase1-4');
  await expect(page.getByRole('heading',{name:card.name,exact:true})).toBeVisible();
  const panel=page.getByTestId('affiliate-shops');await expect(panel.locator('a')).toHaveCount(1);
  const href=await panel.locator('a').getAttribute('href');expect(new URL(href).searchParams.get('q')).toBe('Charizard & friends Base Set 4 English');
  await noOverflow(page);expect(errors).toEqual([]);
});
test('empty and failed optional settings leave marketplace browsing usable',async({page})=>{
  for(const failed of [false,true]){
    await page.unrouteAll({behavior:'wait'});await fixtures(page,{empty:true,failed});await page.goto('/marketplace');
    await expect(page.getByRole('heading',{name:'A little space for the next great find.'})).toBeVisible();await expect(page.getByTestId('affiliate-shops')).toHaveCount(0);
    await page.goto('/admin/affiliate-shops');
    await expect(page.getByTestId('affiliate-publication')).toContainText(failed?'Unable to check saved links':'No saved affiliate links');
  }
});
test('a concurrent save conflict keeps the draft and clears the password',async({page})=>{
  const {posts}=await fixtures(page,{conflict:true});await page.goto('/admin/affiliate-shops');await fillShop(page);
  await page.getByLabel('Current administrator password').fill('Fixture password');await page.getByRole('button',{name:'Save affiliate shops',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Reload before saving');
  await expect(page.getByLabel('Shop name',{exact:true})).toHaveValue('Example cards');await expect(page.getByLabel('Current administrator password')).toHaveValue('');expect(posts).toHaveLength(1);
});

test('Amazon starter entries are paused and binders, sleeves and packs keep supplied links',async({page},info)=>{
  const {errors,posts}=await fixtures(page,{amazon:true});await page.goto('/admin/affiliate-shops');
  await page.getByRole('button',{name:'Add Amazon starter links',exact:true}).click();
  await expect(page.locator('.shop-editor')).toHaveCount(3);
  for(const field of await page.getByLabel('Enable this shop').all())await expect(field).not.toBeChecked();
  await expect(page.getByLabel('Shop name',{exact:true}).first()).toHaveValue('Card binders');
  expect(posts).toHaveLength(0);
  await page.goto('/marketplace?q=Charizard');
  const panel=page.getByTestId('affiliate-shops');await expect(page.getByTestId('amazon-disclosure')).toHaveText(AMAZON_DISCLOSURE);
  for(const entry of AMAZON_STARTERS){
    const link=panel.getByRole('link',{name:entry.name+' on Amazon (opens in a new tab)'});
    await expect(link).toHaveAttribute('href','https://www.amazon.com.au/dp/ABCDEFGHIJ?tag=fixture-22');
    await expect(link).toHaveAttribute('referrerpolicy','strict-origin-when-cross-origin');
  }
  await noOverflow(page);await page.screenshot({path:info.outputPath('amazon-marketplace.png'),fullPage:true});expect(errors).toEqual([]);
});
