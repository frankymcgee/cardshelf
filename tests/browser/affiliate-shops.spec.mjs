import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import {AMAZON_STARTERS,AMAZON_DISCLOSURE} from '../../shared/affiliate-shops.mjs';
const shop=overrides=>({id:'00000000-0000-0000-0000-000000000001',name:'Example cards',description:'English cards and sealed packs',url:'https://shop.example.com/packs?ref=approved%2Bpartner',search_url:'https://shop.example.com/search?q={query}&ref=approved%2Bpartner',referral_code:'ISSUED-CODE',enabled:true,placements:['marketplace','cards','catalogue'],games:[],expires_on:'',...overrides});
const card={id:'en:base1-4',game:'pokemon',name:'Charizard & friends',set_name:'Base Set',local_id:'4',language:'en',rarity:'Rare',faces:[],rules_text:'Fixture card',image_url:'',printings:[]};
const productImageId='00000000-0000-0000-0000-000000000099';
const product=()=>shop({kind:'product',name:'Archive zip binder',description:'A binder for sleeved cards.\nChoose your preferred colour.',image_id:productImageId,retailer:'amazon',url:'https://www.amazon.com.au/dp/ABCDEFGHIJ?tag=fixture-22',search_url:'',referral_code:''});
const productPhoto=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#eeeaf9"/><rect x="110" y="30" width="260" height="300" rx="20" fill="#6757b8"/><path d="M140 30V330" stroke="#473679" stroke-width="12"/><rect x="185" y="115" width="120" height="90" rx="8" fill="#ded7f5"/><text x="245" y="164" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#473679">CARD BINDER</text></svg>')).png().toBuffer();
async function fixtures(page,{empty=false,failed=false,conflict=false,amazon=false,products=false,brokenImage=false,uploadFails=false}={}){
  const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
  let settings={enabled:false,shops:[],revision:1};
  await page.route('https://shop.example.com/**',route=>route.abort());
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let data;
    if(path==='/api/session')data={user:{id:'affiliate-fixture',name:'Affiliate tester',role:'admin'},setup_required:false};
    else if(path==='/api/admin/affiliate-shops/images'){
      if(uploadFails)return route.fulfill({status:415,json:{message:'Use a still JPEG, PNG or WebP image.'}});
      data={id:productImageId,width:480,height:360};
    }
    else if(path.startsWith('/api/admin/affiliate-shops/images/')||path.startsWith('/api/public/affiliate-images/')){
      return brokenImage?route.fulfill({status:404,json:{message:'Image unavailable'}}):route.fulfill({contentType:'image/png',body:productPhoto});
    }
    else if(path==='/api/admin/affiliate-shops'){
      if(route.request().method()==='POST'){
        const body=route.request().postDataJSON();posts.push(body);
        if(conflict)return route.fulfill({status:409,json:{message:'Affiliate settings changed. Reload before saving.'}});
        settings={enabled:body.enabled,shops:body.shops,revision:body.revision+1};
      }data=settings;
    }
    else if(path==='/api/public/affiliate-shops'){
      if(failed)return route.fulfill({status:503,json:{message:'Temporarily unavailable'}});
      data={shops:empty?[]:products?[product(),shop()]:amazon?AMAZON_STARTERS.map((entry,i)=>shop({...entry,id:String(i),retailer:'amazon',url:'https://www.amazon.com.au/dp/ABCDEFGHIJ?tag=fixture-22',search_url:'',referral_code:''})):[shop(),shop({id:'00000000-0000-0000-0000-000000000002',name:'MTG only',games:['mtg']})]};
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

for(const mode of ['light','dark'])test(mode+' manual product cards upload, preview and publish without price or checkout',async({page},info)=>{
  const {errors,posts}=await fixtures(page,{products:true});
  await page.addInitScript(value=>localStorage.setItem('cardshelf.theme',value),mode);await page.goto('/admin/affiliate-shops');
  await page.getByRole('button',{name:'Add product card',exact:true}).click();await expect(page.getByLabel('Enable this shop')).not.toBeChecked();
  await page.getByLabel('Product name',{exact:true}).fill(product().name);await page.getByLabel('Product description',{exact:true}).fill(product().description);
  await page.getByLabel('Affiliate product URL',{exact:true}).fill(product().url);
  await page.getByLabel('Product image',{exact:true}).setInputFiles({name:'my-binder.png',mimeType:'image/png',buffer:productPhoto});
  await expect(page.locator('.affiliate-image-preview')).toHaveAttribute('src','/api/admin/affiliate-shops/images/'+productImageId);
  const preview=page.getByTestId('affiliate-product');await expect(preview).toContainText(product().name);await expect(preview.getByRole('link')).toHaveText(/View on Amazon/);
  expect(posts).toHaveLength(0);await expect(page.getByLabel('Optional affiliate search URL')).toHaveCount(0);
  await preview.scrollIntoViewIfNeeded();await noOverflow(page);await page.screenshot({path:info.outputPath(mode+'-manual-product-admin.png'),fullPage:true});
  await page.getByLabel('Enable this shop').check();await page.getByLabel('Show affiliate shopping links').check();
  await page.getByLabel('Current administrator password').fill('Fixture password');await page.getByRole('button',{name:'Save affiliate shops',exact:true}).click();
  await expect(page.getByText('Affiliate shops saved.',{exact:true})).toBeVisible();expect(posts[0].shops[0].image_id).toBe(productImageId);expect(posts[0].shops[0].kind).toBe('product');
  await page.goto('/marketplace');const tile=page.getByTestId('affiliate-product');
  await expect(tile.getByRole('img')).toHaveAttribute('src','/api/public/affiliate-images/'+productImageId);await tile.scrollIntoViewIfNeeded();
  await expect.poll(()=>tile.getByRole('img').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
  await expect(tile.getByRole('link')).toHaveAttribute('href',product().url);await expect(tile.getByRole('link')).toHaveAttribute('rel','sponsored nofollow noopener');
  await expect(tile).not.toContainText(/\$|Add to cart|In stock/i);await expect(page.getByTestId('amazon-disclosure')).toBeVisible();
  await page.getByLabel('Search',{exact:true}).fill('Different product');await expect(tile.getByRole('link')).toHaveAttribute('href',product().url);
  await noOverflow(page);await tile.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(mode+'-manual-product-marketplace.png'),fullPage:true});
  await page.getByRole('link',{name:'My listings',exact:true}).click();await expect(tile).toHaveCount(0);expect(errors).toEqual([]);
});
test('failed images leave product links usable and failed uploads preserve form edits',async({page})=>{
  const {errors}=await fixtures(page,{products:true,brokenImage:true,uploadFails:true});await page.goto('/marketplace');
  const tile=page.getByTestId('affiliate-product');await tile.scrollIntoViewIfNeeded();await expect(tile).toContainText('Product image unavailable');await expect(tile.getByRole('link')).toHaveAttribute('href',product().url);
  await page.goto('/admin/affiliate-shops');await page.getByRole('button',{name:'Add product card',exact:true}).click();
  await page.getByLabel('Product name',{exact:true}).fill('My draft binder');await page.getByLabel('Affiliate product URL',{exact:true}).fill(product().url);
  await page.getByLabel('Product image',{exact:true}).setInputFiles({name:'binder.png',mimeType:'image/png',buffer:productPhoto});
  await expect(page.getByRole('alert')).toContainText('Use a still JPEG');await expect(page.getByLabel('Product name',{exact:true})).toHaveValue('My draft binder');
  await expect(page.getByLabel('Affiliate product URL',{exact:true})).toHaveValue(product().url);expect(errors).toEqual([]);
});
