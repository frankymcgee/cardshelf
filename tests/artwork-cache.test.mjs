import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const origin='https://cardshelf.example',local=n=>origin+'/api/public/catalogue/artwork/'+n.toString(16).padStart(64,'0');
const external=n=>'https://www.pokemon.com/static-assets/content-assets/cms2/img/cards/web/MEE/MEE_EN_'+n+'.png';
const ART='cardshelf-artwork-v1',META='cardshelf-artwork-meta-v1';
function opaque() {
  const response=new Response('hidden');
  Object.defineProperty(response,'type',{value:'opaque'});response.clone=opaque;return response;
}
function worker() {
  const listeners={},stores=new Map(),network=[];
  let clock=Date.now(),offline=false,quota=false,timer=0;
  const key=value=>typeof value==='string'?value:value.url;
  const storage={
    async open(name) {
      if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);
      return {async match(url){return entries.get(key(url))?.clone();},
        async put(url,response){if(quota)throw Error('QuotaExceededError');entries.set(key(url),response.clone());},
        async delete(url){return entries.delete(key(url));},async keys(){return [...entries.keys()].map(url=>({url}));},async add(){}};
    },async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}
  };
  const self={location:{origin},addEventListener:(type,handler)=>listeners[type]=handler};
  const context=vm.createContext({self,URL,Response,Blob,caches:storage,
    setTimeout:()=>++timer,clearTimeout:()=>{},Date:class extends Date{static now(){return clock;}},
    fetch:async(url,options)=>{
      network.push({url,options});if(offline)throw Error('offline');
      return url.startsWith(origin)?new Response('image',{headers:{'Content-Type':'image/webp'}}):opaque();
    }});
  vm.runInContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),context);
  async function image(url,extra={},client='collector') {
    const waits=[];let answer;
    listeners.fetch({request:{method:'GET',destination:'image',mode:'no-cors',url,...extra},clientId:client,
      respondWith:p=>answer=p,waitUntil:p=>waits.push(p)});
    return {response:await answer,waits};
  }
  async function decoded(url,loaded=true,client='collector') {
    const waits=[];
    listeners.message({data:{type:'cardshelf-artwork-'+(loaded?'loaded':'failed'),url},source:{id:client,url:origin+'/cards'},waitUntil:p=>waits.push(p)});
    await Promise.all(waits);
  }
  return {image,decoded,listeners,stores,network,storage,context,
    advance:ms=>clock+=ms,setOffline:value=>offline=value,setQuota:value=>quota=value};
}
test('public artwork is persisted after decoding and reused without a network fetch',async()=>{
  const w=worker();const first=await w.image(local(1));assert.equal(first.response.status,200);
  assert.equal(w.stores.get(ART)?.size||0,0);
  await w.decoded(local(1));await Promise.all(first.waits);
  w.setOffline(true);
  assert.equal(await (await w.image(local(1))).response.text(),'image');assert.equal(w.network.length,1);
  assert.equal(w.network[0].options.credentials,'omit');assert.equal(w.network[0].options.referrerPolicy,'no-referrer');
});
test('opaque provider errors are never cached; only a matching client confirms a decode',async()=>{
  const w=worker();await w.image(external(1));await w.decoded(external(1),false);
  assert.equal(w.stores.get(ART)?.size||0,0);
  await w.image(external(2));await w.decoded(external(2),true,'another-client');assert.equal(w.stores.get(ART)?.size||0,0);
  await w.decoded(external(2));assert.equal(w.stores.get(ART).size,1);
  assert.equal((await w.image(external(2))).response.type,'opaque');assert.equal(w.network.length,2);
});
test('private images, API data, arbitrary hosts, query strings and non-images never enter the cache',async()=>{
  const w=worker();
  for(const url of [origin+'/api/session',origin+'/api/binders/id/wallpaper',origin+'/api/account/export',
    origin+'/api/public/affiliate-images/id',local(1)+'?account=private',external(1)+'?x=1',
    'https://evil.test/image.png','https://assets.tcgdex.net.evil.test/image.png',
    'https://www.pokemon.com/other/image.png','https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/private.png']) {
    assert.equal((await w.image(url)).response,undefined,url);
  }
  assert.equal((await w.image(local(1),{destination:'',mode:'cors'})).response,undefined);
  assert.equal((await w.image(local(1),{method:'POST'})).response,undefined);assert.equal(w.network.length,0);
});
test('cache expiry reloads the exact source; artwork is independent of user sessions',async()=>{
  const w=worker();await w.image(local(1));await w.decoded(local(1));w.advance(31*86400000);
  await w.image(local(1));await w.decoded(local(1));assert.equal(w.network.length,2);
  assert.deepEqual([...w.stores.get(ART).keys()],[local(1)]);
});
test('entry count and expensive opaque responses are bounded separately',async()=>{
  const w=worker();
  for(let n=1;n<=201;n++){w.advance(1);await w.image(local(n));await w.decoded(local(n));}
  assert.equal(w.stores.get(ART).size,200);assert.equal(w.stores.get(ART).has(local(1)),false);
  for(let n=1;n<=7;n++){w.advance(1);await w.image(external(n));await w.decoded(external(n));}
  const metadata=await Promise.all([...w.stores.get(META).values()].map(r=>r.clone().json()));
  assert.equal(metadata.filter(r=>r.opaque).length,6);assert.ok(metadata.length<=200);
  assert.ok(metadata.reduce((n,r)=>n+r.bytes,0)<=64*1024*1024);
  assert.equal(w.stores.get(ART).has(external(1)),false);assert.equal(w.stores.get(ART).has(local(201)),true);
});
test('storage failures do not break artwork or clear unrelated caches',async()=>{
  const w=worker();await w.storage.open('unrelated');w.setQuota(true);
  assert.equal((await w.image(local(1))).response.status,200);await w.decoded(local(1));
  assert.equal(w.stores.has(ART),false);assert.equal(w.stores.has(META),false);assert.equal(w.stores.has('unrelated'),true);
});
test('no-store, error statuses, non-images and oversized bodies remain uncached',async()=>{
  for(const response of [new Response('missing',{status:404}),new Response('html',{headers:{'Content-Type':'text/html'}}),
    new Response('private',{headers:{'Content-Type':'image/webp','Cache-Control':'no-store'}}),
    new Response('too large',{headers:{'Content-Type':'image/webp','Content-Length':5*1024*1024}}),
    new Response(new Uint8Array(4*1024*1024+1),{headers:{'Content-Type':'image/webp'}})]) {
    const w=worker();w.context.fetch=async()=>response;await w.image(local(1));await w.decoded(local(1));
    assert.equal(w.stores.get(ART)?.size||0,0);
  }
});
test('duplicate pockets share a response while a reloaded client can confirm its own image',async()=>{
  const w=worker();await w.image(local(1));await w.image(local(1));assert.equal(w.network.length,1);
  await w.image(local(1),{},'reloaded');await w.decoded(local(1),true,'reloaded');
  assert.equal(w.stores.get(ART).size,1);await w.decoded(local(1),false);
  w.setOffline(true);assert.equal((await w.image(local(1))).response.status,200);
});
