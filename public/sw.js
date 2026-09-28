/* Installable shell and visible push notifications. Do not cache authenticated responses, API data,
   collection exports or card images. Offline editing is NOT implemented. */
const CACHE='cardshelf-static-v0.45.0';
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
  if(event.request.method!=='GET' || url.origin!==self.location.origin || url.pathname.startsWith('/api/')) return;
  if(event.request.mode==='navigate') {
    event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
  }
  // Static Nuxt assets are left to normal browser HTTP caching. No user data
  // can survive logout in a service-worker cache.
});
