import {test,expect} from '@playwright/test';
import sharp from 'sharp';
const owner='11111111-aaaa-4111-8111-111111111111',binderId='22222222-bbbb-4222-8222-222222222222',normal='33333333-cccc-4333-8333-333333333333',holo='44444444-dddd-4444-8444-444444444444';
const photos=await Promise.all(['#dfc955','#7abb8e','#efadcb'].map(async(fill,index)=>({name:'private-card-'+index+'.png',mimeType:'image/png',buffer:await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" rx="16" fill="${fill}"/><text x="20" y="40" font-size="20">Fixture ${index+1}</text><rect x="20" y="70" width="260" height="180" rx="8" fill="#bde0ec"/><text x="20" y="390" font-size="18">025 / 100 TEST</text></svg>`)).png().toBuffer()})));
const card={id:'en:batch-fixture-025',game:'pokemon',language:'en',name:'Batch Pikachu',local_id:'025',set_name:'Batch fixture set',image_url:'data:image/png;base64,'+photos[0].buffer.toString('base64'),printings:[{id:normal,key:'normal',label:'Normal'},{id:holo,key:'holo',label:'Holo'}],match_evidence:['Card number','Name'],match_strength:'Multiple details match'};
async function fixtures(page,{theme='light',limit=0,lostUpload=false,lostSave=false,delayed=false,tracking=false,full=false,disabled=false,failed=false}={}){
  const calls=[],errors=[],receipts=new Map();let quantity=2,revision=7,release;
  const binder={id:binderId,title:'Batch binder',game:'pokemon',binder_type:tracking?'tracking':'collection',columns:2,rows:2,page_count:1,revision:4,slots:full?Array.from({length:4},(_,position)=>({position,printing_id:normal})):tracking?[{position:2,printing_id:holo,is_collected:false}]:[]};
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  await page.addInitScript(value=>localStorage.setItem('cardshelf.theme',value),theme);
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=decodeURIComponent(new URL(request.url()).pathname),method=request.method(),body=method==='POST'?request.postDataJSON():null;
    calls.push({path,method,body});let data;
    if(path==='/api/session')data={user:{id:owner,name:'Batch tester',role:'user'},setup_required:false};
    else if(path==='/api/account/games')data={tier:'complimentary'};
    else if(path==='/api/account/membership')data={access:{allowed:true,features:[],tier:'complimentary'}};
    else if(path.startsWith('/api/ads/'))data={eligible:false};
    else if(path==='/api/binders')data=[binder];
    else if(path==='/api/binders/'+binderId)data=binder;
    else if(path==='/api/cards/'+card.id)data={...card,entries:[{printing_id:holo,condition:'UNKNOWN',quantity,revision}]};
    else if(path==='/api/catalogue')data={items:[card],total:1};
    else if(path==='/api/scans'&&method==='GET')data={enabled:!disabled,eligible:true,available:!disabled&&(!limit||receipts.size<limit),unlimited:limit===0,monthly_limit:limit,remaining:limit?Math.max(0,limit-receipts.size):null,binder_types:['collection','tracking'],message:disabled?'Scanning is disabled.':limit&&receipts.size>=limit?'Monthly limit reached.':'',recent:[...receipts.values()].slice(-12)};
    else if(path==='/api/scans'&&method==='POST'){
      if(receipts.has(body.request_id))data=receipts.get(body.request_id);
      else{
        const r={id:body.request_id,status:delayed?'processing':failed?'failed':'ready',observations:{card_count:1,readable:true},candidates:[card],created_at:new Date().toISOString(),error:failed?'Recognition failed.':''};receipts.set(r.id,r);
        if(delayed){delayed=false;await new Promise(resolve=>release=()=>{r.status='ready';resolve()})}
        data=r;
      }
      if(lostUpload){lostUpload=false;return route.abort('failed')}
    }else if(path.endsWith('/confirm')){
      const id=path.split('/')[3],r=receipts.get(id);
      if(r.status==='added')data=r;
      else{
        if(body.entry_revision!==revision)return route.fulfill({status:409,json:{message:'Ownership changed. Review again.'}});
        let placement=null;
        if(body.binder){
          if(body.binder.revision!==binder.revision)return route.fulfill({status:409,json:{message:'Binder changed.'}});
          const target=binder.slots.find(s=>s.printing_id===body.printing_id),position=target?.position??[0,1,2,3].find(p=>!binder.slots.some(s=>s.position===p));
          if(position===undefined)return route.fulfill({status:409,json:{message:'Binder full.'}});
          const inserted=!target,marked=tracking&&!target?.is_collected;
          if(inserted)binder.slots.push({position,printing_id:body.printing_id,is_collected:tracking});else if(marked)target.is_collected=true;
          if(inserted||marked)binder.revision++;
          placement={id:binderId,title:binder.title,binder_type:binder.binder_type,position,page:1,pocket:position+1,inserted,marked_collected:marked,revision:binder.revision};
        }
        const previous=quantity;quantity+=body.quantity;revision++;
        r.status='added';r.addition={quantity:body.quantity,name:card.name,printing_label:'Holo',previous_quantity:previous,binder:placement};data=r;
      }
      if(lostSave){lostSave=false;return route.abort('failed')}
    }else if(path.endsWith('/undo')){
      const r=receipts.get(path.split('/')[3]);quantity=r.addition.previous_quantity;revision++;
      const placement=r.addition.binder;if(placement?.marked_collected){binder.slots.find(s=>s.position===placement.position).is_collected=false;binder.revision++}
      r.status='undone';data=r;
    }else if(path.startsWith('/api/scans/')){data=receipts.get(path.split('/')[3]);if(!data)return route.fulfill({status:404,json:{message:'Scan not found.'}})}
    else return route.fulfill({status:404,json:{message:'Unexpected fixture '+path}});
    await route.fulfill({json:data});
  });
  return {calls,errors,receipts,binder,release:()=>release?.(),quantity:()=>quantity};
}
const analyse=async page=>{await page.getByRole('checkbox',{name:'Send the queued card photos to OpenAI for recognition.'}).check();await page.getByRole('button',{name:'Analyse queued photos',exact:true}).click()};
async function upload(page,files){const input=page.getByLabel('Choose card photos',{exact:true});await expect(input).toBeEnabled();await input.setInputFiles(files)}
async function queue(page,files=photos.slice(0,2),path='/scan?mode=batch&binder='+binderId){
  await page.goto(path);await expect(page.getByRole('heading',{name:'Scan a batch',exact:true})).toBeVisible();
  await upload(page,files);await expect(page.locator('.batch-item')).toHaveCount(files.length);
}
async function review(page,index=1,owned=2){
  await page.getByRole('button',{name:'Review photo '+index,exact:true}).click();await page.locator('.scan-candidate').click();
  await expect(page.getByRole('button',{name:'Confirm & add to collection',exact:true})).toBeDisabled();
  await page.getByRole('combobox',{name:'Printing / finish',exact:true}).selectOption(holo);await expect(page.locator('.scan-ownership')).toContainText('You own '+owned);
}
const posts=state=>state.calls.filter(c=>c.path==='/api/scans'&&c.method==='POST');
async function fits(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}
for(const theme of ['light','dark'])test(theme+' multi-photo queue, explicit printing review, shared binder and quantity refresh',async({page},info)=>{
  const state=await fixtures(page,{theme});await queue(page);await expect(page.getByRole('button',{name:'Analyse queued photos',exact:true})).toBeDisabled();expect(posts(state)).toHaveLength(0);
  await analyse(page);await expect(page.getByRole('button',{name:'Review photo 2',exact:true})).toBeEnabled();expect(posts(state)).toHaveLength(2);expect(state.quantity()).toBe(2);
  await fits(page);await page.screenshot({path:info.outputPath(theme+'-queue.png'),fullPage:true});await review(page);
  await expect(page.getByTestId('scan-placement')).toContainText('Page 1, pocket 1');await page.getByLabel('Copies to add').fill('2');
  await page.getByRole('button',{name:'Confirm & add to collection',exact:true}).click();await expect(page.getByRole('heading',{name:'Another card on your shelf.'})).toBeVisible();
  await page.getByRole('button',{name:'Next card to review'}).click();await page.locator('.scan-candidate').click();await page.getByRole('combobox',{name:'Printing / finish',exact:true}).selectOption(holo);
  await expect(page.locator('.scan-ownership')).toContainText('You own 4');await expect(page.getByTestId('scan-placement')).toContainText('already set up');
  await page.getByRole('button',{name:'Confirm & add to collection',exact:true}).click();await expect(page.getByRole('heading',{name:'Another card on your shelf.'})).toBeVisible();
  expect(state.quantity()).toBe(5);const saves=state.calls.filter(c=>c.path.endsWith('/confirm'));expect(saves.map(c=>c.body.entry_revision)).toEqual([7,8]);expect(saves.map(c=>c.body.binder.revision)).toEqual([4,5]);expect(state.binder.slots).toHaveLength(1);expect(state.errors).toEqual([]);
});
test('the single scanner exposes batch mode and keeps the selected binder',async({page})=>{
  await fixtures(page);await page.goto('/scan?binder='+binderId);await page.getByRole('button',{name:'Scan a batch',exact:true}).click();await expect(page).toHaveURL(/mode=batch/);await expect(page.getByRole('combobox',{name:'Add scanned cards to',exact:true})).toHaveValue(binderId);
});
test('duplicate photos are ignored and session storage excludes image data and filenames',async({page})=>{
  await fixtures(page);await queue(page,[photos[0]]);await upload(page,[photos[0]]);await expect(page.locator('.batch-notice')).toContainText('duplicate');await expect(page.locator('.batch-item')).toHaveCount(1);
  const saved=await page.evaluate(key=>sessionStorage.getItem(key),'cardshelf.scan-batch.v1:'+owner);expect(saved).not.toContain('data:image');expect(saved).not.toContain('private-card');expect(saved).not.toContain('candidates');
});
test('pause waits for the current photo then an explicit continue processes the rest',async({page})=>{
  const state=await fixtures(page,{delayed:true});await queue(page);await analyse(page);await expect.poll(()=>posts(state).length).toBe(1);await expect(page.getByRole('button',{name:'Pause after this photo',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Pause after this photo',exact:true}).click();state.release();
  await expect(page.locator('.batch-notice')).toContainText('Queue paused');expect(posts(state)).toHaveLength(1);await page.getByRole('button',{name:'Analyse queued photos',exact:true}).click();await expect(page.getByRole('button',{name:'Review photo 2',exact:true})).toBeEnabled();expect(posts(state)).toHaveLength(2);
});
test('allowance exhaustion stops new calls while analysed cards remain reviewable',async({page})=>{
  const state=await fixtures(page,{limit:1});await queue(page);await analyse(page);await expect(page.locator('.batch-panel .alert.error')).toContainText('Monthly limit');expect(posts(state)).toHaveLength(1);await review(page);await expect(page.getByRole('button',{name:'Confirm & add to collection',exact:true})).toBeEnabled();
});
test('lost analysis and save responses recover without additional calls',async({page})=>{
  const state=await fixtures(page,{lostUpload:true,lostSave:true});await queue(page,[photos[0]]);await analyse(page);await review(page);await page.getByRole('button',{name:'Confirm & add to collection',exact:true}).click();await expect(page.getByRole('heading',{name:'Another card on your shelf.'})).toBeVisible();expect(posts(state)).toHaveLength(1);expect(state.calls.filter(c=>c.path.endsWith('/confirm'))).toHaveLength(1);expect(state.quantity()).toBe(3);
});
test('reload checks receipts without re-analysis and restores unprocessed photos by fingerprint',async({page})=>{
  const state=await fixtures(page);await queue(page);await page.getByRole('button',{name:'Skip photo 2',exact:true}).click();await analyse(page);await expect(page.getByRole('button',{name:'Review photo 1',exact:true})).toBeEnabled();await page.reload();
  await expect(page.locator('.batch-notice')).toContainText('Queue restored');expect(posts(state)).toHaveLength(1);await page.getByRole('button',{name:'Restore photo 2',exact:true}).click();
  await expect(page.locator('.batch-item').nth(1)).toContainText('Reselect original photo');await upload(page,[photos[1]]);await expect(page.locator('.batch-item')).toHaveCount(2);await analyse(page);await expect(page.getByRole('button',{name:'Review photo 2',exact:true})).toBeEnabled();expect(posts(state)).toHaveLength(2);
});
test('Tracking review marks its exact pocket and Undo restores the previous mark',async({page})=>{
  const state=await fixtures(page,{tracking:true});await queue(page,[photos[0]]);await analyse(page);await review(page);await expect(page.getByTestId('scan-placement')).toContainText('Page 1, pocket 3');await page.getByRole('button',{name:'Confirm & add to collection',exact:true}).click();await expect(page.getByTestId('scan-binder-receipt')).toContainText('Marked collected');expect(state.binder.slots[0].is_collected).toBe(true);await page.getByRole('button',{name:'Undo this addition'}).click();await expect(page.getByRole('heading',{name:'Addition undone.'})).toBeVisible();expect(state.binder.slots[0].is_collected).toBe(false);
});
test('a full mismatched binder blocks saving without changing inventory',async({page})=>{
  const state=await fixtures(page,{full:true});await queue(page,[photos[0]]);await analyse(page);await review(page);await expect(page.getByRole('button',{name:'Confirm & add to collection',exact:true})).toBeDisabled();expect(state.quantity()).toBe(2);expect(state.calls.filter(c=>c.path.endsWith('/confirm'))).toHaveLength(0);
});
test('file type and 20-photo bounds reject uploads before any paid request',async({page})=>{
  const state=await fixtures(page);await page.goto('/scan?mode=batch');await upload(page,{name:'image.heic',mimeType:'image/heic',buffer:Buffer.from('unsupported')});await expect(page.locator('.batch-panel .alert.error')).toContainText('Convert HEIC');
  await upload(page,Array.from({length:21},(_,i)=>({...photos[0],name:'photo-'+i+'.png'})));await expect(page.locator('.batch-panel .alert.error')).toContainText('no more than 20');expect(posts(state)).toHaveLength(0);
});
test('failed recognition halts remaining uploads and clearing never changes receipts',async({page})=>{
  const state=await fixtures(page,{failed:true});await queue(page);await analyse(page);await expect(page.locator('.batch-panel .alert.error')).toContainText('Recognition failed');expect(posts(state)).toHaveLength(1);
  await page.getByRole('button',{name:'Clear queue',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Clear this queue',exact:true}).click();await expect(page.locator('.batch-item')).toHaveCount(0);expect(state.receipts.size).toBe(1);expect(state.quantity()).toBe(2);
});
test('disabled scanning allows local preparation but cannot dispatch a batch',async({page})=>{
  const state=await fixtures(page,{disabled:true});await queue(page,[photos[0]]);await page.getByRole('checkbox',{name:'Send the queued card photos to OpenAI for recognition.'}).check();await expect(page.getByRole('button',{name:'Analyse queued photos',exact:true})).toBeDisabled();expect(posts(state)).toHaveLength(0);
});
test('skipping the currently reviewed photo closes its addition form without saving',async({page})=>{
  const state=await fixtures(page);await queue(page,[photos[0]]);await analyse(page);await review(page);await page.getByRole('button',{name:'Skip photo 1',exact:true}).click();await expect(page.getByRole('button',{name:'Confirm & add to collection',exact:true})).toHaveCount(0);expect(state.quantity()).toBe(2);await page.getByRole('button',{name:'Restore photo 1',exact:true}).click();await review(page);expect(posts(state)).toHaveLength(1);
});
