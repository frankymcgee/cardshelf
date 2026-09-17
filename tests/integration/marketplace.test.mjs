import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import sharp from 'sharp';
import { hashPassword,randomToken,digest } from '../../lib/security.mjs';
const url=process.env.TEST_BASE_URL,dbUrl=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!url||!new URL(dbUrl||'http://invalid').pathname.endsWith('_test'))throw new Error('Use the disposable _test database only.');
const sql=postgres(dbUrl,{max:4}),origin=process.env.APP_ORIGIN||url;
async function request(path,{method='GET',body,cookie,headers={}}={}){
 const r=await fetch(url+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
 if(r.headers.get('content-type')?.startsWith('image/'))return {status:r.status,data:Buffer.from(await r.arrayBuffer()),headers:r.headers};
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data,headers:r.headers};
}
await test('member marketplace, seller evidence, enquiries and moderation',async t=>{
 const seller=randomUUID(),buyer=randomUUID(),other=randomUUID(),admin=randomUUID(),printing=randomUUID();
 const setId='en:market-'+randomUUID(),cardId=setId+'-1';let listingId,threadId,payload;
 const tokens=[randomToken(),randomToken(),randomToken(),randomToken()];
 const [sellerCookie,buyerCookie,otherCookie,adminCookie]=tokens.map(s=>'cardshelf_session='+s);
 async function current(){return (await request('/api/marketplace/listings/'+listingId,{cookie:sellerCookie})).data}
 async function edit(changes={}){const row=await current();return request('/api/marketplace/listings/'+listingId,{method:'PATCH',cookie:sellerCookie,body:{revision:row.revision,status:row.status,price_minor:row.price_minor,postage_minor:row.postage_minor,description:row.description,...changes}})}
 try{
  const hash=await hashPassword('Marketplace integration password 123');
  for(const [i,id] of [seller,buyer,other,admin].entries()){
   await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${'private-'+id+'@example.test'},${'PRIVATE IDENTITY '+i},${hash},${i===3?'admin':'user'})`;
   await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
  }
  await sql`INSERT INTO card_sets(id,provider_id,language,name,card_count) VALUES(${setId},${setId.slice(3)},'en','Marketplace fixture',1)`;
  await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${cardId},${cardId.slice(3)},${setId},'en','1','Marketplace Test Card')`;
  await sql`INSERT INTO printings(id,card_id,key,label,source) VALUES(${printing},${cardId},'holo','Holo','tcgdex')`;
  await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity) VALUES(${seller},${printing},'NM',6)`;
  const bytes=await sharp({create:{width:12,height:18,channels:3,background:'#335577'}}).png().toBuffer();
  payload={request_id:randomUUID(),printing_id:printing,seller_alias:'Public Test Seller',condition:'NM',price_minor:2499,delivery:'postage',postage_minor:500,region:'Perth, WA',description:'Actual item shown. This is a fixture listing for the disposable test database.',ownership_confirmed:true,photos:['front','back'].map(side=>({side,content_type:'image/png',data_base64:bytes.toString('base64')}))};
  await t.test('marketplace APIs require login, while member access preserves testing',async()=>{
   for(const path of ['access','listings','printings','conversations','reports'])assert.equal((await request('/api/marketplace/'+path)).status,401);
   const r=await request('/api/marketplace/access',{cookie:sellerCookie});assert.equal(r.status,200);assert.equal(r.data.can_sell,true);assert.equal(r.data.payments_enabled,false);
   assert.match((await request('/marketplace')).headers.get('x-robots-tag'),/noindex/);assert.ok(!(await request('/sitemap.xml')).data.includes('/marketplace'));
  });
  await t.test('printing picker exposes only the current user’s own quantity',async()=>{
   const a=await request('/api/marketplace/printings?q=Marketplace%20Test%20Card',{cookie:sellerCookie});const b=await request('/api/marketplace/printings?q=Marketplace%20Test%20Card',{cookie:buyerCookie});
   assert.equal(a.data.find(p=>p.printing_id===printing).owned_quantity,6);assert.equal(b.data.find(p=>p.printing_id===printing).owned_quantity,0);
  });
  await t.test('listing requires ownership confirmation, exact input and real decodable photos',async()=>{
   for(const body of [{...payload,ownership_confirmed:false},{...payload,seller_id:buyer},{...payload,currency:'USD'},{...payload,price_minor:24.99},{...payload,photos:[]}])assert.equal((await request('/api/marketplace/listings',{method:'POST',cookie:sellerCookie,body})).status,400);
   assert.equal((await request('/api/marketplace/listings',{method:'POST',cookie:sellerCookie,body:{...payload,photos:[{side:'front',content_type:'image/png',data_base64:Buffer.from('<svg/>').toString('base64')},payload.photos[1]]}})).status,415);
   assert.equal((await request('/api/marketplace/listings',{method:'POST',cookie:sellerCookie,body:payload,headers:{Origin:'https://other.example'}})).status,403);
  });
  await t.test('publishing is atomic and retry-safe without changing owned quantities',async()=>{
   const r=await request('/api/marketplace/listings',{method:'POST',cookie:sellerCookie,body:payload});assert.equal(r.status,200,JSON.stringify(r.data));listingId=r.data.id;
   const again=await request('/api/marketplace/listings',{method:'POST',cookie:sellerCookie,body:payload});assert.equal(again.data.id,listingId);assert.equal(again.data.replayed,true);
   assert.equal((await request('/api/marketplace/listings',{method:'POST',cookie:sellerCookie,body:{...payload,price_minor:2599}})).status,409);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM marketplace_listings WHERE seller_id=${seller}`)[0].n,1);
   assert.equal((await sql`SELECT quantity FROM collection_entries WHERE user_id=${seller}`)[0].quantity,6);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM marketplace_photos WHERE listing_id=${listingId}`)[0].n,2);
  });
  await t.test('browse and photos expose the ad, not account data or original file metadata',async()=>{
   const r=await request('/api/marketplace/listings?q=Marketplace%20Test%20Card',{cookie:buyerCookie});assert.equal(r.status,200);assert.equal(r.data.items.length,1);assert.equal(r.data.items[0].seller_alias,'Public Test Seller');
   for(const field of ['seller_id','email','password_hash','input_hash','ownership_confirmed_at'])assert.equal(Object.hasOwn(r.data.items[0],field),false);
   assert.ok(!JSON.stringify(r.data).includes('PRIVATE IDENTITY'));assert.ok(!JSON.stringify(r.data).includes('@example.test'));
   assert.equal((await request('/api/marketplace/listings/'+listingId+'/photos/front')).status,401);
   const photo=await request('/api/marketplace/listings/'+listingId+'/photos/front',{cookie:buyerCookie});assert.equal(photo.status,200);assert.match(photo.headers.get('cache-control'),/no-store/);const meta=await sharp(photo.data).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);
  });
  await t.test('seller-only writes and exact filters resist forged ownership and query input',async()=>{
   const row=await current(),body={revision:row.revision,status:'withdrawn',price_minor:row.price_minor,postage_minor:500,description:row.description};
   assert.equal((await request('/api/marketplace/listings/'+listingId,{method:'PATCH',cookie:buyerCookie,body})).status,404);
   assert.equal((await request('/api/marketplace/listings/'+listingId,{method:'PATCH',cookie:sellerCookie,body:{...body,hidden:false}})).status,400);
   assert.equal((await request('/api/marketplace/listings?mine=forged',{cookie:buyerCookie})).status,400);
   assert.equal((await request('/api/marketplace/listings?q=%25_%27%20OR%201%3D1',{cookie:buyerCookie})).data.items.length,0);
  });
  await t.test('enquiries are private, unique and do not reserve or purchase the card',async()=>{
   const row=await current(),body={request_id:randomUUID(),revision:row.revision,message:'Is this card available?'};
   assert.equal((await request('/api/marketplace/listings/'+listingId+'/enquiries',{method:'POST',cookie:sellerCookie,body})).status,400);
   const r=await request('/api/marketplace/listings/'+listingId+'/enquiries',{method:'POST',cookie:buyerCookie,body});assert.equal(r.status,200);threadId=r.data.id;
   assert.equal((await request('/api/marketplace/listings/'+listingId+'/enquiries',{method:'POST',cookie:buyerCookie,body})).data.id,threadId);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM marketplace_messages WHERE conversation_id=${threadId}`)[0].n,1);assert.equal((await current()).status,'active');
   for(const cookie of [otherCookie,adminCookie])assert.equal((await request('/api/marketplace/conversations/'+threadId,{cookie})).status,404);
   const inbox=await request('/api/marketplace/conversations',{cookie:sellerCookie});assert.ok(inbox.data.items.some(t=>t.id===threadId));assert.ok(!JSON.stringify(inbox.data).includes('@example.test'));
  });
  await t.test('asking-price edits preserve the enquiry snapshot and stale enquiries fail',async()=>{
   const old=await current();assert.equal((await edit({price_minor:3499})).status,200);
   const thread=(await request('/api/marketplace/conversations/'+threadId,{cookie:buyerCookie})).data.thread;assert.equal(thread.quoted_price_minor,2499);
   assert.equal((await request('/api/marketplace/listings/'+listingId+'/enquiries',{method:'POST',cookie:otherCookie,body:{request_id:randomUUID(),revision:old.revision,message:'Old price enquiry'}})).status,409);
  });
  await t.test('messages are participant-only, plain text and idempotent even under concurrency',async()=>{
   const body={request_id:randomUUID(),message:'<script>not executable</script> Condition details here.'};
   const replies=await Promise.all([request('/api/marketplace/conversations/'+threadId+'/messages',{method:'POST',cookie:sellerCookie,body}),request('/api/marketplace/conversations/'+threadId+'/messages',{method:'POST',cookie:sellerCookie,body})]);assert.ok(replies.every(r=>r.status===200));assert.equal(replies[0].data.id,replies[1].data.id);
   assert.equal((await request('/api/marketplace/conversations/'+threadId+'/messages',{method:'POST',cookie:sellerCookie,body:{...body,message:'Different message'}})).status,409);
   assert.equal((await request('/api/marketplace/conversations/'+threadId+'/messages',{method:'POST',cookie:otherCookie,body:{request_id:randomUUID(),message:'intruder'}})).status,404);
   const chat=await request('/api/marketplace/conversations/'+threadId,{cookie:buyerCookie});assert.equal(chat.data.messages.length,2);assert.equal(chat.data.messages[1].body,body.message);assert.equal(chat.data.messages[1].mine,false);
   assert.equal((await request('/api/marketplace/conversations/'+threadId+'?before=bad',{cookie:buyerCookie})).status,400);
  });
  await t.test('reserved listings cannot accept another new enquiry',async()=>{
   assert.equal((await edit({status:'reserved'})).status,200);const row=await current();
   assert.equal((await request('/api/marketplace/listings/'+listingId+'/enquiries',{method:'POST',cookie:otherCookie,body:{request_id:randomUUID(),revision:row.revision,message:'Please reserve this'}})).status,409);
   assert.equal((await edit({status:'active'})).status,200);
  });
  await t.test('concurrent listing updates fail explicitly rather than overwriting each other',async()=>{
   const row=await current(),body={revision:row.revision,status:'active',price_minor:4000,postage_minor:500,description:row.description};
   const result=await Promise.all([request('/api/marketplace/listings/'+listingId,{method:'PATCH',cookie:sellerCookie,body}),request('/api/marketplace/listings/'+listingId,{method:'PATCH',cookie:sellerCookie,body:{...body,price_minor:4500}})]);
   assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
  });
  await t.test('reports deduplicate and only administrators can moderate listings',async()=>{
   const body={reason:'misleading',details:'Please review the supplied photo and printing.'};
   for(let i=0;i<2;i++)assert.equal((await request('/api/marketplace/listings/'+listingId+'/report',{method:'POST',cookie:otherCookie,body})).status,200);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM marketplace_reports WHERE listing_id=${listingId}`)[0].n,1);
   assert.equal((await request('/api/marketplace/reports',{cookie:buyerCookie})).status,403);
   const row=await current(),moderation={revision:row.revision,hidden:true,reason:'Photographs require administrator review.'};
   assert.equal((await request('/api/marketplace/listings/'+listingId+'/moderate',{method:'POST',cookie:sellerCookie,body:moderation})).status,403);
   assert.equal((await request('/api/marketplace/listings/'+listingId+'/moderate',{method:'POST',cookie:adminCookie,body:moderation})).status,200);
  });
  await t.test('hidden listings leave the market and sellers cannot bypass moderation',async()=>{
   assert.equal((await request('/api/marketplace/listings/'+listingId,{cookie:otherCookie})).status,404);
   assert.equal((await request('/api/marketplace/listings/'+listingId+'/photos/front',{cookie:otherCookie})).status,404);
   assert.equal((await request('/api/marketplace/listings?q=Marketplace%20Test%20Card',{cookie:otherCookie})).data.items.length,0);
   assert.equal((await edit({status:'active'})).status,409);
   assert.equal((await request('/api/marketplace/listings/'+listingId,{cookie:buyerCookie})).status,200);
   assert.equal((await request('/api/marketplace/conversations/'+threadId+'/messages',{method:'POST',cookie:buyerCookie,body:{request_id:randomUUID(),message:'Still there?'}})).status,409);
   const row=await current();assert.equal((await request('/api/marketplace/listings/'+listingId+'/moderate',{method:'POST',cookie:adminCookie,body:{revision:row.revision,hidden:false,reason:'Review completed; listing may be visible again.'}})).status,200);
  });
  await t.test('either participant can close a conversation without reopening it on retry',async()=>{
   const chat=await request('/api/marketplace/conversations/'+threadId,{cookie:buyerCookie});
   assert.equal((await request('/api/marketplace/conversations/'+threadId+'/close',{method:'POST',cookie:buyerCookie,body:{revision:chat.data.thread.revision}})).status,200);
   assert.equal((await request('/api/marketplace/conversations/'+threadId+'/messages',{method:'POST',cookie:sellerCookie,body:{request_id:randomUUID(),message:'New message'}})).status,409);
   const row=await current();assert.equal((await request('/api/marketplace/listings/'+listingId+'/enquiries',{method:'POST',cookie:buyerCookie,body:{request_id:randomUUID(),revision:row.revision,message:'Reopen request'}})).data.id,threadId);
   assert.equal((await request('/api/marketplace/conversations/'+threadId,{cookie:buyerCookie})).data.thread.closed,true);
  });
  await t.test('seller-reported sold status is terminal and never changes inventory',async()=>{
   assert.equal((await edit({status:'sold'})).status,200);assert.equal((await edit({status:'active'})).status,409);
   assert.equal((await sql`SELECT quantity FROM collection_entries WHERE user_id=${seller}`)[0].quantity,6);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM collection_entries WHERE user_id=${buyer}`)[0].n,0);
  });
  await t.test('past-due subscription metadata cannot remove tester marketplace access',async()=>{
   await sql`UPDATE account_memberships SET plan_code='collector',subscription_status='past_due' WHERE user_id=${seller}`;
   assert.equal((await request('/api/marketplace/access',{cookie:sellerCookie})).data.can_sell,true);
   const membership=await request('/api/account/membership',{cookie:sellerCookie});assert.equal(membership.data.access.payment_required,false);assert.equal(membership.data.access.expires_at,null);assert.ok(membership.data.access.features.some(f=>f.code==='marketplace_sell'));
  });
  await t.test('withdrawn unused listings can be deleted along with photos only',async()=>{
   const r=await request('/api/marketplace/listings',{method:'POST',cookie:sellerCookie,body:{...payload,request_id:randomUUID()}});assert.equal(r.status,200);const id=r.data.id;
   const row=(await request('/api/marketplace/listings/'+id,{cookie:sellerCookie})).data;
   const saved=await request('/api/marketplace/listings/'+id,{method:'PATCH',cookie:sellerCookie,body:{revision:row.revision,status:'withdrawn',price_minor:row.price_minor,postage_minor:row.postage_minor,description:row.description}});assert.equal(saved.status,200);
   assert.equal((await request('/api/marketplace/listings/'+id,{method:'DELETE',cookie:sellerCookie,body:{revision:saved.data.revision}})).status,200);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM marketplace_photos WHERE listing_id=${id}`)[0].n,0);
   assert.equal((await sql`SELECT quantity FROM collection_entries WHERE user_id=${seller}`)[0].quantity,6);
  });
 }finally{
  await sql`DELETE FROM app_users WHERE id IN (${seller},${buyer},${other},${admin})`;
  await sql`DELETE FROM printings WHERE id=${printing}`;await sql`DELETE FROM cards WHERE id=${cardId}`;await sql`DELETE FROM card_sets WHERE id=${setId}`;await sql.end();
 }
});
