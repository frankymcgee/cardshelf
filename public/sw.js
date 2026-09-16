/* Installable shell only. Do not cache authenticated responses, API data,
   collection exports or card images. Offline editing is NOT implemented. */
const CACHE='cardshelf-static-v0.4.0';
self.addEventListener('install',event=> {
  event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html')));
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
