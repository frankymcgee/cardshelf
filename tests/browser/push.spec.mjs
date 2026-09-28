import {test,expect} from '@playwright/test';
import webpush from 'web-push';
const publicKey=webpush.generateVAPIDKeys().publicKey;
async function fixtures(page,options={}) {
  const writes=[],errors=[];
  let saved={enabled:!!options.enabled,marketplace:true,membership:true,revision:1};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(o=>{
    if(o.ios){Object.defineProperty(navigator,'userAgent',{get:()=> 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1'});Object.defineProperty(navigator,'standalone',{get:()=>!!o.installed})}
    if(o.insecure)Object.defineProperty(window,'isSecureContext',{get:()=>false});
    localStorage.setItem('cardshelf.theme',o.theme||'light');
    window.pushFixture={permissionCalls:0,subscribes:0,unsubscribes:0,gestures:[],prompts:0};
    if(o.realWorker)return;
    let permission=o.permission||'default',subscription=o.enabled||o.stale?makeSubscription():null;
    function makeSubscription(){return {endpoint:'https://fcm.googleapis.com/fcm/send/browser-fixture',toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/browser-fixture',keys:{p256dh:'fixture',auth:'fixture'}}),unsubscribe:async()=>{window.pushFixture.unsubscribes++;subscription=null;return true;}}}
    Object.defineProperty(Notification,'permission',{get:()=>permission,configurable:true});
    Notification.requestPermission=async()=>{window.pushFixture.permissionCalls++;window.pushFixture.gestures.push(navigator.userActivation.isActive);permission=o.choice||'granted';return permission;};
    const registration={pushManager:{getSubscription:async()=>subscription,subscribe:async options=>{window.pushFixture.subscribes++;window.pushFixture.subscriptionOptions={userVisibleOnly:options.userVisibleOnly,keyLength:options.applicationServerKey.length};subscription=makeSubscription();return subscription;}},getNotifications:async()=>[]};
    Object.defineProperty(navigator.serviceWorker,'ready',{get:()=>Promise.resolve(registration)});
    navigator.serviceWorker.register=async()=>registration;navigator.serviceWorker.getRegistration=async()=>registration;
    if(o.unsupported)delete window.PushManager;
  },options);
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,body=request.method()==='POST'?request.postDataJSON():null;
    if(body)writes.push({path,body});let data;
    if(path==='/api/session')data={user:{id:'push-fixture',name:'Collector',role:'user'},setup_required:false};
    else if(path==='/api/account/push')data={available:options.available!==false,public_key:publicKey};
    else if(path==='/api/account/push/status')data=saved;
    else if(path==='/api/account/push/subscribe'){
      if(options.failSubscribe)return route.fulfill({status:500,json:{message:'Could not save this device.'}});
      saved={enabled:true,...body.preferences,revision:1};data=saved;
    }
    else if(path==='/api/account/push/preferences'){
      if(options.conflict)return route.fulfill({status:409,json:{message:'Notification settings changed. Reload before saving.'}});
      saved={enabled:true,...body.preferences,revision:saved.revision+1};data=saved;
    }
    else if(path==='/api/account/push/unsubscribe'){saved={enabled:false};data=saved;}
    else if(path==='/api/account/push/test')data={queued:true};
    else if(path==='/api/account/membership')data={access:{tier:'complimentary',features:[],allowed:true}};
    else if(path==='/api/account/games')data={tier:'complimentary',games:[]};
    else if(path==='/api/dashboard')data={counts:{},binders:[],progress:[]};
    else if(path==='/api/prices/summary')data={enabled:false};
    else if(path==='/api/public/affiliate-shops')data={shops:[]};
    else if(path.startsWith('/api/ads/'))data={eligible:false};
    else if(path==='/api/public/platform'||path==='/api/logout')data={};
    else return route.fulfill({status:404,json:{message:'Unexpected fixture '+path}});
    return route.fulfill({json:data});
  });
  return {writes,errors};
}
async function open(page,options={}){const f=await fixtures(page,options);await page.goto('/notifications');await expect(page.getByRole('heading',{name:'App & notifications'})).toBeVisible();await expect(page.getByText('Checking this device…')).toHaveCount(0);return f;}
async function nativePrompt(page,outcome='accepted') {await page.evaluate(outcome=>{const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{window.pushFixture.prompts++};event.userChoice=Promise.resolve({outcome});window.dispatchEvent(event);},outcome);}
test('native installation is click-driven and the prompt disappears after installation',async({page})=>{
  const {errors}=await fixtures(page);await page.goto('/app');await expect(page.getByRole('heading',{name:'Collection overview'})).toBeVisible();
  await nativePrompt(page);await expect(page.getByRole('button',{name:'Install CardShelf',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.pushFixture.prompts)).toBe(0);
  await page.getByRole('button',{name:'Install CardShelf',exact:true}).click();expect(await page.evaluate(()=>window.pushFixture.prompts)).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await expect(page.locator('.install-banner')).toHaveCount(0);expect(errors).toEqual([]);
});
test('install dismissal persists while manual installation remains accessible',async({page})=>{
  await fixtures(page,{ios:true});await page.goto('/app');await page.getByRole('button',{name:'Maybe later'}).click();await page.reload();await expect(page.locator('.install-banner')).toHaveCount(0);
  await page.goto('/notifications');await page.getByRole('button',{name:'How to install'}).click();await expect(page.getByText('Open CardShelf in Safari.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Enable notifications',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>window.pushFixture.permissionCalls)).toBe(0);
});
test('iPhone Home Screen app can opt in without showing an install offer',async({page})=>{
  await open(page,{ios:true,installed:true});await expect(page.getByRole('heading',{name:'CardShelf is installed'})).toBeVisible();await expect(page.getByRole('button',{name:'How to install'})).toHaveCount(0);
  await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await expect(page.getByText('On for this device',{exact:true})).toBeVisible();
});
test('opt-in, per-device preferences, test delivery and unsubscribe use the real controls',async({page},info)=>{
  const {writes,errors}=await open(page,{theme:info.project.name==='phone'?'dark':'light'});
  expect(await page.evaluate(()=>window.pushFixture.permissionCalls)).toBe(0);expect(writes).toEqual([]);
  await page.getByLabel('Membership updates').uncheck();await page.getByRole('button',{name:'Enable notifications',exact:true}).click();
  await expect(page.getByText('Notifications are on for this device.')).toBeVisible();
  expect(writes.find(w=>w.path.endsWith('/subscribe')).body.preferences).toEqual({marketplace:true,membership:false});
  expect(await page.evaluate(()=>window.pushFixture.gestures)).toEqual([true]);expect(await page.evaluate(()=>window.pushFixture.subscriptionOptions)).toEqual({userVisibleOnly:true,keyLength:65});
  await page.getByLabel('Marketplace messages').uncheck();await page.getByRole('button',{name:'Save preferences'}).click();await expect(page.getByText('Notification preferences saved for this device.')).toBeVisible();
  await page.getByRole('button',{name:'Send test notification'}).click();await expect(page.getByRole('status')).toContainText('Test notification queued');
  expect(writes.find(w=>w.path.endsWith('/test')).body).toEqual({endpoint:'https://fcm.googleapis.com/fcm/send/browser-fixture'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath('notifications-'+info.project.name+'.png'),fullPage:true});
  await page.getByRole('button',{name:'Turn off on this device'}).click();await expect(page.getByText('Off for this device',{exact:true})).toBeVisible();expect(await page.evaluate(()=>window.pushFixture.unsubscribes)).toBe(1);expect(errors).toEqual([]);
});
test('permission denial neither subscribes nor registers a device',async({page})=>{
  const {writes}=await open(page,{choice:'denied'});await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await expect(page.getByText('Notifications are blocked for CardShelf.',{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>window.pushFixture.subscribes)).toBe(0);expect(writes).toEqual([]);await page.getByRole('button',{name:'Check again'}).click();expect(await page.evaluate(()=>window.pushFixture.permissionCalls)).toBe(1);
});
test('failed persistence rolls back the browser subscription',async({page})=>{
  await open(page,{failSubscribe:true});await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Could not save this device.');
  await expect(page.getByText('Off for this device',{exact:true})).toBeVisible();expect(await page.evaluate(()=>window.pushFixture.unsubscribes)).toBe(1);
});
test('stale sign-ins require explicit opt-in and old subscriptions are replaced',async({page})=>{
  await open(page,{stale:true,permission:'granted'});expect(await page.evaluate(()=>window.pushFixture.subscribes)).toBe(0);
  await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await expect(page.getByText('On for this device',{exact:true})).toBeVisible();expect(await page.evaluate(()=>window.pushFixture.unsubscribes)).toBe(1);
});
test('conflicting preferences require reload and sign-out clears the browser subscription',async({page})=>{
  const {writes}=await open(page,{enabled:true,permission:'granted',conflict:true});await page.getByRole('button',{name:'Save preferences'}).click();await expect(page.getByRole('button',{name:'Save preferences'})).toBeDisabled();
  await page.getByRole('button',{name:'Reload saved preferences'}).click();await expect(page.getByRole('button',{name:'Save preferences'})).toBeEnabled();
  await page.getByRole('button',{name:'Open account and settings'}).filter({visible:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL('/');expect(writes.some(w=>w.path==='/api/logout')).toBe(true);expect(await page.evaluate(()=>window.pushFixture.unsubscribes)).toBe(1);
});
test('unsupported and insecure devices receive useful guidance without a permission request',async({page})=>{
  await open(page,{unsupported:true});await expect(page.getByText('This browser does not support push notifications.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Enable notifications',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>window.pushFixture.permissionCalls)).toBe(0);
});
test('insecure pages never offer push permission',async({page})=>{
  await open(page,{insecure:true});await expect(page.getByText('Open CardShelf over HTTPS to enable notifications.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>window.pushFixture.permissionCalls)).toBe(0);
});
test('revoked browser permission removes a previously registered device',async({page})=>{
  const {writes}=await open(page,{enabled:true,permission:'denied'});await expect(page.getByText('Off for this device',{exact:true})).toBeVisible();expect(writes.some(w=>w.path.endsWith('/unsubscribe'))).toBe(true);expect(await page.evaluate(()=>window.pushFixture.unsubscribes)).toBe(1);
});
test('real production service worker installs, updates and provides the offline navigation shell',async({page,context})=>{
  await fixtures(page,{realWorker:true});await page.goto('/notifications');
  await expect.poll(()=>page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration('/'))?.active)).toBe(true);
  const cache=await page.evaluate(async()=>({keys:await caches.keys(),entries:await (await caches.open('cardshelf-static-v0.45.0')).keys().then(entries=>entries.map(e=>new URL(e.url).pathname))}));
  expect(cache.keys).toContain('cardshelf-static-v0.45.0');expect(cache.entries).toEqual(['/offline.html']);
  await context.setOffline(true);await page.goto('/app');await expect(page.locator('body')).toContainText(/offline/i);await context.setOffline(false);
});
