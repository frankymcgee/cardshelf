import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {batchItemState,batchHasWork,batchSummary,batchSnapshot,restoreBatchSnapshot,runScanBatch} from '../shared/scan-batch.mjs';
const item=(patch={})=>({id:randomUUID(),fingerprint:randomUUID().replaceAll('-','').repeat(2),image:'data:image/jpeg;base64,YWJj',submitted:false,skipped:false,receipt:null,error:'',...patch});
const receipt=(i,status='ready')=>({id:i.id,status,candidates:[],error:''});
const dependencies=(extra={})=>({api:async()=>{},availability:async()=>({available:true}),update:(i,p)=>Object.assign(i,p),wait:async()=>{},...extra});
test('queue summary distinguishes review, saved, skipped, recovery and missing photos',()=>{
  const a=item(),b=item(),c=item(),d=item({skipped:true}),e=item({image:''}),f=item({submitted:true});
  b.receipt=receipt(b);c.receipt=receipt(c,'added');
  assert.deepEqual(batchSummary([a,b,c,d,e,f]),{total:6,queued:2,ready:1,added:1,skipped:1,missing_photos:1});
  assert.equal(batchItemState(e),'photo');assert.equal(batchItemState(f),'check');
});
test('session recovery stores only identities, never photos, names, candidates or ownership',()=>{
  const a=item({submitted:true,filename:'private-photo.jpg'});a.receipt={...receipt(a),addition:{notes:'secret'}};
  const text=batchSnapshot('owner',[a]);assert.ok(!text.includes('data:image'));assert.ok(!text.includes('private-photo'));assert.ok(!text.includes('secret'));
  assert.deepEqual(Object.keys(JSON.parse(text).items[0]).sort(),['id','fingerprint','submitted','skipped'].sort());
  const restored=restoreBatchSnapshot(text,'owner');assert.equal(restored[0].id,a.id);assert.equal(restored[0].image,'');assert.equal(restored[0].receipt,null);assert.equal(restored[0].submitted,true);
  assert.deepEqual(restoreBatchSnapshot(text,'someone-else'),[]);
});
test('corrupt, oversized, duplicate and cross-account snapshots fail closed',()=>{
  const a=item(),valid=JSON.parse(batchSnapshot('owner',[a]));
  for(const v of [null,'not json','x'.repeat(20001),JSON.stringify({...valid,version:2}),JSON.stringify({...valid,items:Array(21).fill(valid.items[0])}),JSON.stringify({...valid,items:[valid.items[0],valid.items[0]]}),JSON.stringify({...valid,items:[{...valid.items[0],id:'../../admin'}]}),JSON.stringify({...valid,items:[{...valid.items[0],submitted:'yes'}]}),JSON.stringify({...valid,items:[{...valid.items[0],id:[a.id]}]})])assert.deepEqual(restoreBatchSnapshot(v,'owner'),[]);
});
test('unprocessed metadata requires its original photo while submitted IDs remain recoverable',()=>{
  const a=item(),b=item({submitted:true});const restored=restoreBatchSnapshot(batchSnapshot('owner',[a,b]),'owner');
  assert.equal(batchHasWork(restored[0]),false);assert.equal(batchHasWork(restored[1]),true);
});
test('analysis is sequential, refreshes access per photo and never confirms inventory',async()=>{
  const rows=[item(),item(),item()],calls=[];let active=0,max=0,checks=0;
  const result=await runScanBatch(rows,dependencies({availability:async()=>{checks++;return {available:true}},api:async(path,options)=>{
    calls.push({path,body:options?.body});active++;max=Math.max(max,active);await Promise.resolve();active--;
    assert.equal(path,'/api/scans');assert.equal(options.body.confirm_external_processing,true);return {id:options.body.request_id,status:'ready'};
  }}));
  assert.equal(result.status,'complete');assert.equal(result.processed,3);assert.equal(max,1);assert.equal(checks,3);assert.equal(calls.length,3);assert.ok(rows.every(i=>i.submitted&&i.receipt.status==='ready'));
});
test('ready, failed, saved, undone and skipped items cannot silently cause another paid attempt',async()=>{
  const rows=['ready','failed','added','undone'].map(status=>{const i=item();i.receipt=receipt(i,status);return i});rows.push(item({skipped:true}));
  const result=await runScanBatch(rows,dependencies({api:()=>{throw Error('Must not dispatch')}}));assert.equal(result.processed,0);
});
test('pause after an in-flight photo does not dispatch the next photo',async()=>{
  const rows=[item(),item()];let paused=false,posts=0;
  const result=await runScanBatch(rows,dependencies({paused:()=>paused,api:async(path,options)=>{posts++;paused=true;return {id:options.body.request_id,status:'ready'}}}));
  assert.equal(posts,1);assert.equal(result.status,'paused');assert.equal(rows[1].submitted,false);
});
test('lost POST response recovers one receipt without a second provider request',async()=>{
  const a=item(),calls=[];
  const result=await runScanBatch([a],dependencies({api:async(path,options)=>{calls.push({path,options});if(options)throw Error('Connection lost');return receipt(a)}}));
  assert.equal(result.status,'complete');assert.equal(calls.filter(c=>c.options).length,1);assert.equal(calls[1].path,'/api/scans/'+a.id);
});
test('processing receipts are polled read-only before continuing the queue',async()=>{
  const a=item();let posts=0,reads=0,waits=0;
  const result=await runScanBatch([a],dependencies({wait:async()=>{waits++},api:async(path,options)=>{if(options){posts++;return receipt(a,'processing')}reads++;return receipt(a,reads===1?'processing':'ready')}}));
  assert.equal(result.status,'complete');assert.equal(posts,1);assert.equal(reads,2);assert.equal(waits,2);
});
test('quota or budget loss stops before another upload, including zero remaining',async()=>{
  const rows=[item(),item()];let posts=0;
  const result=await runScanBatch(rows,dependencies({availability:async()=>({available:posts===0,message:'Monthly limit reached'}),api:async(path,options)=>{posts++;return {id:options.body.request_id,status:'ready'}}}));
  assert.equal(result.status,'stopped');assert.equal(posts,1);assert.equal(rows[1].submitted,false);assert.match(result.error,/Monthly limit/);
});
test('unlimited access with null remaining still analyses normally',async()=>{
  const a=item();const result=await runScanBatch([a],dependencies({availability:async()=>({available:true,unlimited:true,monthly_limit:0,remaining:null}),api:async()=>receipt(a)}));assert.equal(result.processed,1);
});
test('admission rejection keeps the same request ID for an explicit retry',async()=>{
  const a=item(),id=a.id;let reject=true;const uploads=[];
  const deps=dependencies({api:async(path,options)=>{if(!options)throw {status:404};uploads.push(options.body);if(reject)throw {statusCode:429,data:{message:'Another photo is being analysed'}};return receipt(a)}});
  assert.equal((await runScanBatch([a],deps)).status,'stopped');reject=false;
  assert.equal((await runScanBatch([a],deps)).status,'complete');assert.deepEqual(uploads.map(b=>b.request_id),[id,id]);assert.deepEqual(uploads[0],uploads[1]);
});
test('uncertain recovery does not create a new request or bypass a failed receipt read',async()=>{
  const a=item({submitted:true});let posts=0;
  const result=await runScanBatch([a],dependencies({api:async(path,options)=>{if(options)posts++;throw {statusCode:503,data:{message:'Unavailable'}}}}));
  assert.equal(result.status,'stopped');assert.equal(posts,0);
});
test('restored submitted receipt resolves even when membership no longer permits new scans',async()=>{
  const a=item({submitted:true,image:''});let checks=0;
  const result=await runScanBatch([a],dependencies({availability:async()=>{checks++;return {available:false}},api:async()=>receipt(a)}));assert.equal(result.status,'complete');assert.equal(checks,0);
});
test('failed recognition halts the queue without automatically retrying the charged photo',async()=>{
  const a=item(),b=item();let calls=0;
  const result=await runScanBatch([a,b],dependencies({api:async()=>{calls++;return {...receipt(a,'failed'),error:'Recognition failed'}}}));
  assert.equal(result.status,'stopped');assert.equal(calls,1);assert.equal(b.submitted,false);assert.equal(batchHasWork(a),false);
});
test('leaving during analysis stops all follow-up polls, writes and subsequent uploads',async()=>{
  const a=item(),b=item();let alive=true,updates=0;
  const result=await runScanBatch([a,b],dependencies({alive:()=>alive,update:(i,p)=>{updates++;Object.assign(i,p)},api:async()=>{alive=false;return receipt(a,'processing')}}));
  assert.equal(result.status,'paused');assert.equal(updates,1);assert.equal(b.submitted,false);
});
test('a mismatched receipt never becomes a review result for another queued card',async()=>{
  const a=item();const result=await runScanBatch([a],dependencies({api:async()=>({id:randomUUID(),status:'ready'})}));assert.equal(result.status,'stopped');assert.equal(a.receipt,null);
});
