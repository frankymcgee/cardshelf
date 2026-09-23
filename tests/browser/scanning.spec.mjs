import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import {SCAN_DEFAULTS,SCAN_PROMPT} from '../../shared/card-scanning.mjs';
const cardId='en:scan-fixture-025',normal='11111111-1111-4111-8111-111111111111',holo='22222222-2222-4222-8222-222222222222',binderId='33333333-3333-4333-8333-333333333333';
const fixtureImage=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560"><rect width="400" height="560" rx="18" fill="#f4d24d"/><rect x="20" y="50" width="360" height="220" fill="#d8eaca"/><text x="25" y="35" font-size="20">Synthetic scanner card</text><text x="25" y="530" font-size="20">025 / 100 · TEST</text></svg>')).png().toBuffer();
const card={id:cardId,game:'pokemon',language:'en',name:'Synthetic scanner card',local_id:'025',set_name:'Scanner test set',image_url:'data:image/png;base64,'+fixtureImage.toString('base64'),printings:[{id:normal,key:'normal',label:'Normal'},{id:holo,key:'holo',label:'Holo'}],entries:[{printing_id:holo,condition:'UNKNOWN',quantity:2,revision:7}],match_evidence:['Card number','Name'],match_strength:'Multiple details match'};
const binder={id:binderId,title:'My collection binder',game:'pokemon',binder_type:'collection',columns:2,rows:2,page_count:2,revision:4,slots:[{position:1,printing_id:normal}]};
async function fixtures(page,{noMatches=false,lostConfirmation=false,disabled=false}={}){
  let receipt=null;const calls=[],errors=[];
  let settings={...SCAN_DEFAULTS,revision:1,enabled:false,api_key_set:false,key_available:true,monthly_budget_micros:0,user_monthly_limit:100,input_price_micros:400000,output_price_micros:1600000,reservation_micros:7783};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=decodeURIComponent(new URL(request.url()).pathname),method=request.method(),body=method==='POST'?request.postDataJSON():null;
    calls.push({path,method,body});let data;
    if(path==='/api/session')data={user:{id:'fixture-user',name:'Scanner tester',role:'admin'},setup_required:false};
    else if(path==='/api/account/games')data={tier:'complimentary'};
    else if(path==='/api/binders')data=[binder,{...binder,id:'tracking',binder_type:'tracking',title:'Independent checklist'}];
    else if(path==='/api/binders/'+binderId)data=binder;
    else if(path==='/api/cards/'+cardId)data=card;
    else if(path==='/api/catalogue')data={items:[card],total:1,limit:12};
    else if(path==='/api/scans'&&method==='GET')data={available:!disabled,enabled:!disabled,eligible:true,remaining:99,monthly_limit:100,message:disabled?'Photo scanning has not been enabled by an administrator.':'',recent:receipt?[receipt]:[]};
    else if(path==='/api/scans'&&method==='POST'){
      receipt={id:body.request_id,status:'ready',created_at:new Date().toISOString(),observations:{card_count:1,readable:true},candidates:noMatches?[]:[card],error:'',addition:null};data=receipt;
    }else if(path.endsWith('/confirm')){
      receipt={...receipt,status:'added',addition:{quantity:body.quantity,name:card.name,printing_label:'Holo',binder:body.binder?{...body.binder,title:binder.title}:null}};
      if(lostConfirmation){lostConfirmation=false;return route.abort('failed');}data=receipt;
    }else if(path.endsWith('/undo')){receipt={...receipt,status:'undone'};data=receipt;}
    else if(path.startsWith('/api/scans/'))data=receipt;
    else if(path==='/api/admin/scanning'){
      if(method==='POST'){settings={...settings,...body,revision:settings.revision+1,monthly_budget_micros:body.monthly_budget_usd*1e6,input_price_micros:body.input_usd_per_million*1e6,output_price_micros:body.output_usd_per_million*1e6,api_key_set:!!body.api_key||settings.api_key_set};delete settings.api_key;delete settings.password;data=settings;}
      else data={settings,totals:{scans:3,recognised:3,confirmed:2,uncertain:0,accounted_micros:2880,measured_micros:2880,average_duration_ms:3500},users:[],history:[],models:[{model:SCAN_DEFAULTS.model,resolved_model:SCAN_DEFAULTS.model,reasoning_effort:null,reasoning_mode:null,scans:3,failed:0,accounted_micros:2880,average_duration_ms:3500}]};
    }else return route.fulfill({status:404,json:{message:'Unexpected fixture path '+path}});
    await route.fulfill({json:data});
  });
  return {calls,errors};
}
async function start(page){
  await page.goto('/scan');await expect(page.getByRole('heading',{name:'Scan a card',exact:true})).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({name:'synthetic-card.png',mimeType:'image/png',buffer:fixtureImage});
  await expect(page.getByAltText('Your card photo to analyse')).toBeVisible();
  await expect(page.getByRole('button',{name:'Find this card',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'Send this card photo to OpenAI for recognition.'}).check();
  await page.getByRole('button',{name:'Find this card',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Choose the matching card'})).toBeVisible();
}
async function review(page){
  await page.locator('.scan-candidate').click();
  await expect(page.getByRole('button',{name:'Confirm & add to collection',exact:true})).toBeDisabled();
  await page.getByRole('combobox',{name:'Printing / finish',exact:true}).selectOption(holo);
  await expect(page.getByText('You own', {exact:false})).toContainText('2');
}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);}
test('camera upload, consent, printing choice, binder placement, save and Undo',async({page},info)=>{
  const {calls,errors}=await fixtures(page);await start(page);await review(page);
  await page.getByRole('combobox',{name:'Add to a binder layout',exact:true}).selectOption(binderId);
  await expect(page.getByRole('combobox',{name:'Pocket',exact:true})).toBeVisible();
  expect(await page.getByRole('combobox',{name:'Pocket',exact:true}).locator('option').allTextContents()).not.toContain('Pocket 2 · matching card');
  await page.getByRole('combobox',{name:'Pocket',exact:true}).selectOption('0');
  await noOverflow(page);await page.screenshot({path:info.outputPath('review.png'),fullPage:true});
  await page.getByRole('button',{name:'Confirm & add to collection',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Another card on your shelf.'})).toBeVisible();
  const save=calls.filter(c=>c.path.endsWith('/confirm'));expect(save).toHaveLength(1);
  expect(save[0].body).toEqual({printing_id:holo,condition:'UNKNOWN',quantity:1,entry_revision:7,binder:{id:binderId,revision:4,position:0},confirm:true});
  expect(calls.filter(c=>c.path==='/api/scans'&&c.method==='POST')).toHaveLength(1);
  await page.getByRole('button',{name:'Undo this addition'}).click();await expect(page.getByRole('heading',{name:'Addition undone.'})).toBeVisible();
  expect(errors).toEqual([]);
});
test('lost confirmation response recovers the saved receipt without another addition',async({page})=>{
  const {calls,errors}=await fixtures(page,{lostConfirmation:true});await start(page);await review(page);
  await page.getByRole('button',{name:'Confirm & add to collection',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Another card on your shelf.'})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(calls.filter(c=>c.path.endsWith('/confirm'))).toHaveLength(1);expect(errors).toEqual([]);
});
test('no match offers a manual catalogue search',async({page})=>{
  const {errors}=await fixtures(page,{noMatches:true});await start(page);
  await page.getByRole('textbox',{name:'Card name or number'}).fill('025');await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.locator('.scan-manual-results button').click();await expect(page.getByRole('combobox',{name:'Printing / finish'})).toBeVisible();
  await noOverflow(page);expect(errors).toEqual([]);
});
test('admin connection controls clear credentials after saving and report usage',async({page},info)=>{
  const {calls,errors}=await fixtures(page);await page.goto('/admin/scanning');
  await expect(page.getByRole('heading',{name:'Card scanning',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'OpenAI API key',exact:true}).fill('sk-synthetic-browser-fixture');
  await page.getByRole('spinbutton',{name:'Shared monthly budget (USD)'}).fill('5');
  await page.getByRole('checkbox',{name:'Enable photo scanning for members with collection access'}).check();
  await page.getByLabel('Confirm your administrator password').fill('synthetic password');
  await page.getByRole('button',{name:'Save scanning settings'}).click();
  await expect(page.getByText('Scanning settings saved.')).toBeVisible();
  await expect(page.getByLabel('OpenAI API key',{exact:true})).toHaveValue('');await expect(page.getByLabel('Confirm your administrator password')).toHaveValue('');
  expect(calls.filter(c=>c.path==='/api/admin/scanning'&&c.method==='POST')).toHaveLength(1);
  await noOverflow(page);await page.screenshot({path:info.outputPath('admin.png'),fullPage:true});expect(errors).toEqual([]);
});
test('scanning unavailable gives a clear setup message and disables capture',async({page})=>{
  await fixtures(page,{disabled:true});await page.goto('/scan');
  await expect(page.getByText('Photo scanning has not been enabled by an administrator.')).toBeVisible();
  await expect(page.locator('input[type=file]')).toBeDisabled();
});
test('admin edits model, reasoning, prompt and cost limits, then restores the prompt without losing other settings',async({page},info)=>{
  const {calls,errors}=await fixtures(page);await page.goto('/admin/scanning');
  await expect(page.getByLabel('Recognition prompt',{exact:true})).toHaveValue(SCAN_PROMPT);
  await page.getByLabel('Model name',{exact:true}).fill('synthetic-reasoner');
  await page.getByRole('combobox',{name:'Reasoning effort',exact:true}).selectOption('high');
  await page.getByRole('combobox',{name:'Reasoning mode',exact:true}).selectOption('pro');
  await page.getByLabel('Maximum output tokens',{exact:true}).fill('4096');
  await page.getByRole('combobox',{name:'Image detail',exact:true}).selectOption('auto');
  const prompt='Read the printed number first.\nPreserve Japanese names: ピカチュウ.';
  await page.getByLabel('Recognition prompt',{exact:true}).fill(prompt);
  await page.getByText('Request limits',{exact:true}).click();
  await page.getByLabel('Request timeout (seconds)',{exact:true}).fill('120');
  await page.getByLabel('Input token reservation',{exact:true}).fill('32768');
  await page.getByLabel('USD per million input tokens',{exact:true}).fill('0.1');
  await page.getByLabel('USD per million output tokens',{exact:true}).fill('0.2');
  await expect(page.getByTestId('scan-reservation')).toContainText('$0.0041');
  await page.getByLabel('Confirm your administrator password').fill('synthetic password');
  await page.getByRole('button',{name:'Save scanning settings'}).click();
  await expect(page.getByText('Scanning settings saved.')).toBeVisible();
  const saves=()=>calls.filter(c=>c.path==='/api/admin/scanning'&&c.method==='POST');expect(saves()).toHaveLength(1);
  expect(saves()[0].body).toMatchObject({model:'synthetic-reasoner',reasoning_effort:'high',reasoning_mode:'pro',max_output_tokens:4096,image_detail:'auto',request_timeout_seconds:120,input_token_ceiling:32768,prompt,input_usd_per_million:.1,output_usd_per_million:.2});
  await page.reload();await expect(page.getByLabel('Recognition prompt',{exact:true})).toHaveValue(prompt);
  await expect(page.getByLabel('Model name',{exact:true})).toHaveValue('synthetic-reasoner');
  await expect(page.getByRole('combobox',{name:'Reasoning effort',exact:true})).toHaveValue('high');
  await expect(page.getByLabel('USD per million input tokens',{exact:true})).toHaveValue('0.1');
  await noOverflow(page);await page.screenshot({path:info.outputPath('admin-model-settings.png'),fullPage:true});
  await page.getByRole('button',{name:'Restore default prompt'}).click();expect(saves()).toHaveLength(1);
  await expect(page.getByLabel('Recognition prompt',{exact:true})).toHaveValue(SCAN_PROMPT);
  await page.getByRole('combobox',{name:'Reasoning effort',exact:true}).selectOption({label:'Model default · omit setting'});
  await page.getByRole('combobox',{name:'Reasoning mode',exact:true}).selectOption({label:'Model default · omit setting'});
  await page.getByLabel('Confirm your administrator password').fill('synthetic password');
  await page.getByRole('button',{name:'Save scanning settings'}).click();
  await expect(page.getByText('Scanning settings saved.')).toBeVisible();expect(saves()).toHaveLength(2);
  expect(saves()[1].body).toMatchObject({model:'synthetic-reasoner',reasoning_effort:null,reasoning_mode:null,prompt:SCAN_PROMPT,max_output_tokens:4096});
  expect(errors).toEqual([]);
});
