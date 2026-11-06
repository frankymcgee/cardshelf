import test from 'node:test';
import assert from 'node:assert/strict';
import { costMoney,costDate,remainingCost } from '../lib/cost-logic.mjs';
test('purchase and sale totals preserve postage and fees, including a loss',()=>{
  assert.equal(costMoney({goods_minor:1000,postage_minor:200,currency:'USD',aud_rate:'1.5'}).cost_aud_minor,1800);
  assert.equal(costMoney({gross_minor:100,postage_minor:200,fees_minor:30,currency:'AUD'},true).net_aud_minor,-130);
  assert.equal(costMoney({goods_minor:0}).cost_aud_minor,0);
  assert.throws(()=>costMoney({goods_minor:100,currency:'USD'}),/rate/);
  assert.throws(()=>costMoney({goods_minor:10.5}));
});
test('proportional sales allocate every cent exactly once',()=>{
  for(let quantity=1;quantity<=100;quantity++) {
    const lot={quantity,remaining_quantity:quantity,cost_aud_minor:1001};let sum=0;
    for(let n=quantity;n>0;n--)sum+=remainingCost(lot,n)-remainingCost(lot,n-1);
    assert.equal(sum,1001);assert.equal(remainingCost(lot,0),0);
  }
});
test('historic transaction dates reject invalid dates and the future',()=>{
  assert.equal(costDate('2020-02-29'),'2020-02-29');
  for(const value of ['2023-02-29','2099-01-01','not a date','2026-13-01'])assert.throws(()=>costDate(value));
});
