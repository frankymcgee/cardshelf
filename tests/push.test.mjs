import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import webpush from 'web-push';
import { pushEndpoint,pushSubscription,pushPreferences,pushPayload,pushMessage,pushOriginReady } from '../lib/push-logic.mjs';
import { safeReturnTo } from '../shared/platform.mjs';
const curve=createECDH('prime256v1');curve.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
const conversation_id='12345678-1234-4234-8234-123456789abc';
test('push accepts known HTTPS browser services and rejects arbitrary network targets',()=>{
  for(const host of ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','wns2-by3p.notify.windows.com'])assert.equal(pushEndpoint('https://'+host+'/subscription'), 'https://'+host+'/subscription');
  for(const url of ['http://fcm.googleapis.com/test','https://127.0.0.1/test','https://169.254.169.254/test','https://fcm.googleapis.com.evil.test/test','https://evil.push.apple.com.evil.test/test','https://fcm.googleapis.com:8443/test','https://user:pass@fcm.googleapis.com/test','https://fcm.googleapis.com/test#fragment','https://fcm.googleapis.com/','https://fcm.googleapis.com/\\evil','https://example.test/test'])assert.throws(()=>pushEndpoint(url),undefined,url);
});
test('subscriptions validate real P-256 points and exact encryption key sizes',()=>{
  assert.deepEqual(pushSubscription({...subscription,expirationTime:null}),subscription);
  for(const key of ['auth','p256dh'])for(const value of ['', 'a'.repeat(1000), 'bad key', Buffer.alloc(key==='auth'?15:65).toString('base64url')])assert.throws(()=>pushSubscription({...subscription,keys:{...subscription.keys,[key]:value}}));
  assert.throws(()=>pushSubscription({...subscription,user_id:'untrusted'}));
  assert.throws(()=>pushPreferences({marketplace:true,membership:true,email:'other'}));
  assert.throws(()=>pushPreferences({marketplace:'true',membership:true}));
});
test('notification payloads contain only generic text and approved deep links',()=>{
  for(const kind of ['marketplace_enquiry','marketplace_reply','membership_changed','test']){
    const payload={conversation_id,message_id:'42',message:'PRIVATE MESSAGE',email:'private@example.test'};
    const safe=pushPayload(kind,payload),message=pushMessage(kind,safe,'event:123');
    assert.doesNotMatch(JSON.stringify({safe,message}),/PRIVATE|private@example/);
    assert.ok(message.url.startsWith('/'));assert.equal(message.tag,'event:123');
  }
  assert.throws(()=>pushPayload('arbitrary',{}));assert.throws(()=>pushPayload('marketplace_reply',{conversation_id,message_id:'9223372036854775808'}));
  assert.throws(()=>pushPayload('marketplace_enquiry',{conversation_id:'//evil.test'}));
  assert.equal(safeReturnTo('/notifications'),'/notifications');
});
test('VAPID signs and encrypts a bounded payload without needing a remote API key',()=>{
  const keys=webpush.generateVAPIDKeys();
  const req=webpush.generateRequestDetails(subscription,JSON.stringify(pushMessage('test',{},'test:1')),{vapidDetails:{subject:'https://cardshelf.example',...keys},TTL:300,contentEncoding:'aes128gcm'});
  assert.equal(req.method,'POST');assert.equal(req.endpoint,subscription.endpoint);
  assert.match(req.headers.Authorization,/^vapid /);assert.equal(req.headers['Content-Encoding'],'aes128gcm');
  assert.ok(Buffer.isBuffer(req.body));assert.ok(!req.body.includes(Buffer.from('Notifications are ready')));
});
test('push configuration requires a public HTTPS origin',()=>{
  assert.equal(pushOriginReady('https://cardshelf.cloud'),true);
  for(const origin of ['http://cardshelf.cloud','https://localhost','https://127.0.0.1','nonsense'])assert.equal(pushOriginReady(origin),false);
});
function worker(windows=[]) {
  const listeners={},notifications=[],opened=[],cached=[];
  const self={addEventListener:(name,fn)=>listeners[name]=fn,location:{origin:'https://cardshelf.example'},skipWaiting:async()=>{},
    registration:{showNotification:async(title,options)=>notifications.push({title,options})},
    clients:{claim:async()=>{},matchAll:async()=>windows,openWindow:async url=>opened.push(url)}};
  vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self,URL,fetch:async()=>{throw Error('offline')},caches:{open:async()=>({add:async path=>cached.push(path)}),match:async()=>({offline:true}),keys:async()=>[],delete:async()=>true}});
  const run=async(name,event={})=>{let waiting;listeners[name]({...event,waitUntil:p=>waiting=p});await waiting;};
  return {run,listeners,notifications,opened,cached};
}
test('service worker always shows a visible notification, including malformed payloads',async()=>{
  const w=worker();
  await w.run('push',{data:{json:()=>pushMessage('marketplace_reply',{conversation_id,message_id:'42'},'reply:42')}});
  assert.equal(w.notifications[0].options.data.url,'/marketplace/inbox?thread='+conversation_id);
  for(const data of [null,{json:()=>{throw Error('broken')}},{json:()=>null}])await w.run('push',{data});
  assert.equal(w.notifications.length,4);assert.equal(w.notifications[1].title,'CardShelf update');
});
test('notification click never navigates outside approved CardShelf routes',async()=>{
  for(const url of ['https://evil.test','//evil.test','javascript:alert(1)','/admin','/marketplace/inbox?thread=bad']){
    const w=worker();let closed=false;await w.run('notificationclick',{notification:{data:{url},close:()=>closed=true}});
    assert.equal(closed,true);assert.deepEqual(w.opened,['https://cardshelf.example/notifications']);
  }
});
test('notification click focuses an existing target, or reuses another app window',async()=>{
  let focused=0,navigated;
  const window={url:'https://cardshelf.example/membership',focus:async()=>focused++,navigate:async url=>{navigated=url;return window}};
  const w=worker([window]);await w.run('notificationclick',{notification:{data:{url:'/membership'},close(){}}});
  assert.equal(focused,1);assert.equal(navigated,undefined);assert.deepEqual(w.opened,[]);
  await w.run('notificationclick',{notification:{data:{url:'/notifications'},close(){}}});assert.equal(navigated,'https://cardshelf.example/notifications');assert.equal(focused,2);
});
test('service worker caches only the offline page and leaves API requests untouched',async()=>{
  const w=worker();await w.run('install');assert.deepEqual(w.cached,['/offline.html']);
  let answered=false;w.listeners.fetch({request:{url:'https://cardshelf.example/api/account/push',method:'GET',mode:'navigate'},respondWith:()=>answered=true});assert.equal(answered,false);
  w.listeners.fetch({request:{url:'https://cardshelf.example/app',method:'GET',mode:'navigate'},respondWith:promise=>{answered=true;return promise}});assert.equal(answered,true);
});
