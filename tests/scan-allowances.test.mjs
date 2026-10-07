import test from 'node:test';
import assert from 'node:assert/strict';
import {SCAN_TIERS,scanAllowance,scanTierLimits,scanAllowanceLabel} from '../shared/scan-allowances.mjs';
import {scanningSettingsInput} from '../lib/card-scan-settings.mjs';
const limits={free:5,collector:25,plus:100,complimentary:0};
const input={revision:1,enabled:false,monthly_budget_usd:5,tier_monthly_limits:limits,input_usd_per_million:.4,output_usd_per_million:1.6};
test('each tier uses its own quota, including zero as unlimited',()=>{
  assert.equal(scanAllowance(limits,'free',5).allowed,false);
  assert.equal(scanAllowance(limits,'collector',5).remaining,20);
  assert.equal(scanAllowance(limits,'plus',100).remaining,0);
  assert.deepEqual(scanAllowance(limits,'complimentary',20000),{tier:'complimentary',used:20000,monthly_limit:0,unlimited:true,remaining:null,allowed:true});
  assert.equal(scanAllowance(limits,'unknown').allowed,false);
  assert.equal(scanAllowance(limits,'toString').allowed,false);
});
test('zero is preserved through validated settings and stored tier resolution',()=>{
  assert.deepEqual(scanningSettingsInput(input).tier_monthly_limits,limits);
  assert.equal(scanningSettingsInput({...input,tier_monthly_limits:{...limits,plus:0}}).tier_monthly_limits.plus,0);
  assert.deepEqual(scanTierLimits(Object.fromEntries(Object.entries(limits).map(([key,value])=>[key+'_monthly_limit',value]))),limits);
  assert.equal(scanAllowanceLabel(0),'Unlimited photo scans');
  assert.equal(scanAllowanceLabel(250),'250 photo scans per month');
});
test('zero means unlimited for every backend tier, never a missing allowance',()=>{
  const unlimited=Object.fromEntries(SCAN_TIERS.map(({code})=>[code,0]));
  assert.deepEqual(scanningSettingsInput({...input,tier_monthly_limits:unlimited}).tier_monthly_limits,unlimited);
  for(const {code} of SCAN_TIERS){
    const allowance=scanAllowance(unlimited,code,10000);
    assert.equal(allowance.unlimited,true);assert.equal(allowance.allowed,true);
    assert.equal(scanAllowanceLabel(allowance.monthly_limit),'Unlimited photo scans');
  }
  for(const value of [undefined,null,-1,NaN,'0'])assert.equal(scanAllowanceLabel(value),'Photo scan allowance not available');
  assert.equal(scanAllowanceLabel(1200),'1,200 photo scans per month');
});
for(const value of [-1,1.5,'0',null,10001,Infinity]) test('tier allowance rejects '+String(value),()=>{
  assert.throws(()=>scanningSettingsInput({...input,tier_monthly_limits:{...limits,plus:value}}));
});
test('partial, extra and missing tier settings cannot silently reset access limits',()=>{
  for(const tier_monthly_limits of [[],null,{plus:0},{...limits,admin:0}])assert.throws(()=>scanningSettingsInput({...input,tier_monthly_limits}));
  const {tier_monthly_limits,...old}=input;
  assert.equal(Object.hasOwn(scanningSettingsInput({...old,user_monthly_limit:100}),'tier_monthly_limits'),false);
});
