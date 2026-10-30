/* Installable shell, push and a bounded cache of public card artwork only.
   Authenticated responses, API data and exports are never cached. No offline editing. */
const CACHE='cardshelf-static-v0.58.0';
const ARTWORK='cardshelf-artwork-v1', ARTWORK_META='cardshelf-artwork-meta-v1';
const DAY=86400000, MAX_ARTWORK=200, MAX_OPAQUE=6, MAX_BYTES=64*1024*1024, MAX_IMAGE=4*1024*1024;
const pendingArtwork=new Map();
let artworkWrites=Promise.resolve();

function artworkUrl(url) {
  if(url.search || url.hash || url.username || url.password)return false;
  if(url.origin===self.location.origin)return /^\/api\/public\/catalogue\/artwork\/[a-f0-9]{64}$/.test(url.pathname);
  if(url.protocol!=='https:' || url.port || !/\.(?:webp|png|jpe?g|avif)$/i.test(url.pathname))return false;
  return url.hostname==='assets.tcgdex.net' ||
    (url.hostname==='www.pokemon.com' && url.pathname.startsWith('/static-assets/content-assets/cms2/img/cards/web/')) ||
    (url.hostname==='limitlesstcg.nyc3.cdn.digitaloceanspaces.com' && url.pathname.startsWith('/tpci/'));
}
function artworkWrite(work) {
  const result=artworkWrites.then(work).catch(()=>{});
  artworkWrites=result;return result;
}
async function trimArtwork(cache,metadata) {
  const entries=[];
  for(const key of await metadata.keys()) {
    const value=await (await metadata.match(key)).json();
    entries.push({key,...value});
  }
  entries.sort((a,b)=>a.time-b.time);
  const remove=async entry=>{
    await cache.delete(entry.key);await metadata.delete(entry.key);
    entries.splice(entries.indexOf(entry),1);
  };
  for(const entry of [...entries])if(Date.now()-entry.time>=(entry.opaque?7:30)*DAY)await remove(entry);
  while(entries.filter(e=>e.opaque).length>MAX_OPAQUE)await remove(entries.find(e=>e.opaque));
  while(entries.length>MAX_ARTWORK || entries.reduce((n,e)=>n+e.bytes,0)>MAX_BYTES)await remove(entries[0]);
}
async function saveArtwork(url,response) {
  const opaque=response.type==='opaque';
  let stored=response,bytes=7*1024*1024; // Chromium pads opaque entries; cap these separately.
  if(!opaque) {
    const reader=response.body?.getReader();if(!reader)return;
    const chunks=[];bytes=0;
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;if(bytes>MAX_IMAGE){reader.cancel().catch(()=>{});return;}chunks.push(value);
    }
    stored=new Response(new Blob(chunks),{headers:{'Content-Type':response.headers.get('Content-Type')}});
  }
  await artworkWrite(async()=>{
    try {
      const cache=await caches.open(ARTWORK),metadata=await caches.open(ARTWORK_META);
      await cache.put(url,stored);await metadata.put(url,new Response(JSON.stringify({time:Date.now(),bytes,opaque})));
      await trimArtwork(cache,metadata);
    } catch {
      // Keep image viewing available when storage is denied or full.
      await Promise.allSettled([caches.delete(ARTWORK),caches.delete(ARTWORK_META)]);
    }
  });
}
async function cachedArtwork(event,url) {
  try {
    const cache=await caches.open(ARTWORK),metadata=await caches.open(ARTWORK_META);
    const [image,record]=await Promise.all([cache.match(url.href),metadata.match(url.href)]);
    if(image && record) {
      const info=await record.json();
      if(Date.now()-info.time<(info.opaque?7:30)*DAY)return image;
    }
  } catch { /* Image loading stays available without storage. */ }
  const key=url.href+'\n'+event.clientId;
  if(pendingArtwork.has(key))return pendingArtwork.get(key).response.clone();
  const external=url.origin!==self.location.origin;
  // Fetch requires no-cors to use redirect mode follow. connect-src still
  // restricts destinations to the public artwork providers.
  const options={credentials:'omit',referrerPolicy:'no-referrer',redirect:external?'follow':'error',mode:external?'no-cors':'same-origin'};
  let response;
  if(url.hostname==='assets.tcgdex.net') {
    try{response=await fetch(url.href,{...options,mode:'cors',redirect:'error'});}catch{/* Preserve ordinary no-CORS image loading. */}
  }
  response ||= await fetch(url.href,options);
  const opaque=response.type==='opaque';
  const usable=opaque || (response.ok && /^image\/(?:webp|png|jpe?g|avif|gif|svg\+xml)(?:;|$)/i.test(response.headers.get('Content-Type')||'') &&
    !/no-store/i.test(response.headers.get('Cache-Control')||'') && Number(response.headers.get('Content-Length')||0)<=MAX_IMAGE);
  // A reloaded document gets its own decode confirmation. Concurrent pockets
  // within one client receive the same response.
  if(pendingArtwork.has(key))return pendingArtwork.get(key).response.clone();
  if(usable && event.clientId && pendingArtwork.size<24) {
    let resolve;
    const waiting=new Promise(done=>resolve=done);
    const timer=setTimeout(()=>{pendingArtwork.delete(key);resolve();},15000);
    pendingArtwork.set(key,{response:response.clone(),client:event.clientId,resolve,timer,committing:false});
    event.waitUntil(waiting);
  }
  return response;
}
self.addEventListener('message',event=>{
  const data=event.data;
  if(!['cardshelf-artwork-loaded','cardshelf-artwork-failed'].includes(data?.type) || typeof data.url!=='string')return;
  let url;try{url=new URL(data.url,self.location.origin);}catch{return;}
  if(!artworkUrl(url) || !event.source || typeof event.source.url!=='string' || new URL(event.source.url).origin!==self.location.origin)return;
  const key=url.href+'\n'+event.source.id,entry=pendingArtwork.get(key);
  if(!entry || entry.committing)return;
  entry.committing=true;clearTimeout(entry.timer);
  // Opaque responses hide errors. Persist only after the actual image decoded.
  const work=data.type==='cardshelf-artwork-loaded'?saveArtwork(url.href,entry.response.clone()):Promise.resolve();
  event.waitUntil(work.catch(()=>{}).finally(()=>{pendingArtwork.delete(key);entry.resolve();}));
});
self.addEventListener('install',event=> {
  event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html')).then(()=>self.skipWaiting()));
});

function notificationPath(value) {
  if(typeof value!=='string')return '/notifications';
  if(['/notifications','/membership'].includes(value))return value;
  if(/^\/marketplace\/inbox\?thread=[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))return value;
  return '/notifications';
}
self.addEventListener('push',event=> {
  let payload={};try{payload=event.data?.json()||{};}catch{/* Always show a visible fallback. */}
  if(!payload||typeof payload!=='object')payload={};
  event.waitUntil(self.registration.showNotification(
    typeof payload.title==='string'?payload.title.slice(0,100):'CardShelf update',{
      body:typeof payload.body==='string'?payload.body.slice(0,240):'Open CardShelf to view your update.',
      icon:'/icon-192.png',badge:'/icon-192.png',
      tag:typeof payload.tag==='string'?payload.tag.slice(0,200):'cardshelf-update',
      data:{url:notificationPath(payload.url)}
    }));
});
self.addEventListener('notificationclick',event=> {
  event.notification.close();
  const target=new URL(notificationPath(event.notification.data?.url),self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const exact=windows.find(client=>client.url===target);
    if(exact){await exact.focus();return;}
    const existing=windows.find(client=>new URL(client.url).origin===self.location.origin&&'navigate' in client);
    if(existing){try{const navigated=await existing.navigate(target);if(navigated){await navigated.focus();return;}}catch{/* Open a fresh window if it closed. */}}
    await self.clients.openWindow(target);
  })());
});
self.addEventListener('activate',event=> {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('cardshelf-static-') && k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=> {
  const url=new URL(event.request.url);
  if(event.request.method==='GET' && event.request.destination==='image' && artworkUrl(url)) {
    event.respondWith(cachedArtwork(event,url));return;
  }
  if(event.request.method!=='GET' || url.origin!==self.location.origin || url.pathname.startsWith('/api/')) return;
  if(event.request.mode==='navigate') {
    event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
  }
  // Static Nuxt assets are left to normal browser HTTP caching. No user data
  // can survive logout in a service-worker cache.
});
