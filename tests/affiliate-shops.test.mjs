import test from 'node:test';
import assert from 'node:assert/strict';
import { affiliateUrl, affiliateSearch, affiliateLinks, amazonShop, AMAZON_STARTERS, affiliateImageUrl } from '../shared/affiliate-shops.mjs';
import { affiliateSettingsInput, publicAffiliateShops } from '../lib/affiliate-shops.mjs';

const shop = (overrides={}) => ({id:'00000000-0000-0000-0000-000000000001',name:'Example shop',description:'Cards and packs',url:'https://shop.example.com/packs?affiliate=approved%2Bcode&campaign=cardshelf',search_url:'https://shop.example.com/search?q={query}&affiliate=approved%2Bcode',referral_code:'ISSUED-CODE',enabled:true,placements:['marketplace','cards','catalogue'],games:[],expires_on:'',...overrides});
const input = overrides => ({enabled:true,shops:[shop()],revision:1,password:' Password with spaces ',...overrides});
const now = new Date('2026-09-26T23:59:59Z');

test('manual product cards preserve fixed destinations and accept only local image identifiers',async()=>{
  const product=shop({kind:'product',search_url:'',image_id:'00000000-0000-0000-0000-000000000002',name:'Binder '.repeat(17),description:'My original description.\n'.repeat(20)});
  const saved=affiliateSettingsInput(input({shops:[product]})).shops[0];
  assert.equal(saved.content_source,'manual');assert.equal(saved.kind,'product');assert.equal(saved.image_id,product.image_id);
  assert.equal(affiliateLinks([product],{placement:'marketplace',search:'other product'},now)[0].href,product.url);
  // A legacy/malformed search value must never redirect a product's identity.
  assert.equal(affiliateLinks([{...product,search_url:shop().search_url}],{placement:'cards',card:{name:'Different card'}},now)[0].href,product.url);
  assert.equal(affiliateImageUrl(product),'/api/public/affiliate-images/'+product.image_id);
  assert.equal(affiliateImageUrl(product,true),'/api/admin/affiliate-shops/images/'+product.image_id);
  for(const image_id of ['https://evil.example/image.png','../../private','',null,12])assert.equal(affiliateImageUrl({...product,image_id}),'');
  const pub=await publicAffiliateShops(async()=>[{enabled:true,shops:[saved]}]);
  assert.equal(pub.shops[0].image_id,product.image_id);assert.equal(pub.shops[0].kind,'product');assert.equal(pub.shops[0].content_source,undefined);
  for(const change of [{kind:'imported'},{content_source:'amazon_api'},{image_url:'https://evil.example/pixel'},{image_base64:'bad'},{image_id:'https://evil.example/image.png'},{image_id:null},{kind:'shop'},{search_url:shop().search_url},{name:'x'.repeat(121)},{description:'x'.repeat(601)}]){
    assert.throws(()=>affiliateSettingsInput(input({shops:[{...product,...change}]})),e=>e.status===400);
  }
  const legacy=affiliateSettingsInput(input()).shops[0];assert.equal(legacy.kind,'shop');assert.equal(legacy.image_id,'');assert.equal(affiliateImageUrl({...product,kind:'shop'}),'');
});

test('affiliate URLs preserve tracking bytes and reject executable, private or malformed destinations',()=>{
  assert.equal(affiliateUrl(shop().url),shop().url);
  for(const url of ['http://shop.example.com','javascript:alert(1)','data:text/html,bad','//shop.example.com','https://user:pass@shop.example.com','https://localhost','https://shop.local','https://127.0.0.1','https://[::1]','https://shop.example.com:8443','https://shop.example.com/white space','https://shop.example.com/%0d%0aHeader','https://shop.example.com/\\evil','https://shop.example.com/%5cevil','https://shop.example.com/{query}','https://shop.example.com/{secret}'])assert.equal(affiliateUrl(url),null,url);
  for(const url of ['https://{query}.example.com','https://shop.example.com/no-placeholder','https://shop.example.com/?q={query}&other={token}','https://shop.example.com/#q={query}'])assert.equal(affiliateUrl(url,true),null,url);
  assert.equal(affiliateUrl('https://shop.example.com/search/{query}?ref=approved',true),'https://shop.example.com/search/{query}?ref=approved');
});

test('searches encode public card identity, retain tracking parameters and never include private notes',()=>{
  const card={id:'en:base1-4',name:'A&B / 日本語',set_name:'Base Set',local_id:'4',language:'en',notes:'PRIVATE NOTE',owner_email:'PRIVATE EMAIL'};
  const query=affiliateSearch(card),links=affiliateLinks([shop()],{placement:'cards',card},now);
  const url=new URL(links[0].href);
  assert.equal(url.searchParams.get('q'),'A&B / 日本語 Base Set 4 English');
  assert.equal(url.searchParams.get('affiliate'),'approved+code');
  assert.equal(links[0].isSearch,true);assert.doesNotMatch(query,/PRIVATE/);
  assert.equal(new URL(affiliateLinks([shop()],{placement:'marketplace',search:'Booster & box'},now)[0].href).searchParams.get('q'),'Booster & box');
  for(const search_url of ['', 'javascript:{query}', 'https://shop.example.com/?q={query}&x='+ 'a'.repeat(2030)]){
    const [link]=affiliateLinks([shop({search_url})],{placement:'cards',card},now);
    assert.equal(link.href,shop().url);assert.equal(link.isSearch,false);
  }
});

test('placements, game selection, expiry and pause controls hide inappropriate shops',()=>{
  const shops=[shop({name:'All'}),shop({name:'Expired',expires_on:'2026-09-25'}),shop({name:'Last day',expires_on:'2026-09-26'}),shop({name:'Paused',enabled:false}),shop({name:'MTG',games:['mtg']}),shop({name:'Market only',placements:['marketplace']})];
  assert.deepEqual(affiliateLinks(shops,{placement:'cards',card:{id:'en:base1-4'}},now).map(s=>s.name),['All','Last day']);
  assert.deepEqual(affiliateLinks(shops,{placement:'cards',card:{id:'mtg:en:abc'}},now).map(s=>s.name),['All','Last day','MTG']);
  assert.deepEqual(affiliateLinks(shops,{placement:'marketplace'},now).map(s=>s.name),['All','Last day','MTG','Market only']);
  assert.deepEqual(affiliateLinks(shops,{placement:'messages'},now),[]);
  assert.deepEqual(affiliateLinks(null,{placement:'cards'},now),[]);
});

test('settings validate bounded fields and preserve the administrator password exactly',()=>{
  const valid=affiliateSettingsInput(input());assert.equal(valid.password,' Password with spaces ');assert.equal(valid.shops[0].url,shop().url);
  const invalid=[input({enabled:'true'}),input({revision:0}),input({password:123}),input({unexpected:'x'}),input({shops:[shop(),shop()]}),input({shops:Array.from({length:13},(_,i)=>shop({id:'00000000-0000-0000-0000-'+String(i).padStart(12,'0')}))})];
  for(const change of [{name:''},{url:'javascript:bad'},{search_url:'https://example.com/'},{expires_on:'2026-02-30'},{placements:[]},{placements:['cards','cards']},{games:['digimon']},{enabled:1},{secret:'private'},{referral_code:'x'.repeat(81)}])invalid.push(input({shops:[shop(change)]}));
  for(const value of invalid)assert.throws(()=>affiliateSettingsInput(value),e=>e.status===400,JSON.stringify(value));
});

test('public settings omit private metadata and hide drafts, expired shops and global pauses',async()=>{
  const shops=[shop({private:'not public'}),shop({enabled:false,name:'Draft'}),shop({expires_on:'2000-01-01',name:'Expired'})];
  const publicData=await publicAffiliateShops(async()=>[{enabled:true,shops,revision:42,updated_by:'private-admin'}]);
  assert.equal(publicData.shops.length,1);assert.equal(publicData.shops[0].referral_code,'ISSUED-CODE');
  assert.doesNotMatch(JSON.stringify(publicData),/private|revision|updated_by|Draft|Expired/);
  assert.deepEqual(await publicAffiliateShops(async()=>[{enabled:false,shops}]),{shops:[]});
});

test('Amazon supplied links remain intact, are recognised without a checkbox, and cannot use search or coupon substitutions',()=>{
  assert.equal(AMAZON_STARTERS.length,3);
  for(const url of ['https://www.amazon.com.au/dp/ABCDEFGHIJ?tag=fixture-22&linkCode=ll1','https://amzn.to/fixture','https://amzn.asia/d/fixture']){
    const amazon=shop({url,search_url:'',referral_code:''});
    assert.equal(amazonShop(amazon),true);
    assert.equal(affiliateSettingsInput(input({shops:[amazon]})).shops[0].retailer,'amazon');
    const [link]=affiliateLinks([amazon],{placement:'marketplace',search:'unrelated card'},now);assert.equal(link.href,url);assert.equal(link.isSearch,false);
    for(const change of [{search_url:shop().search_url},{referral_code:'not-a-coupon'}])assert.throws(()=>affiliateSettingsInput(input({shops:[{...amazon,...change}]})),e=>e.status===400);
  }
  for(const url of ['https://amazon.com.evil.example.com/','https://notamazon.com/'])assert.equal(amazonShop({url}),false);
  assert.throws(()=>affiliateSettingsInput(input({shops:[shop({retailer:'amazon'})]})),e=>e.status===400);
});
