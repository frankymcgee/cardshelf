import test from 'node:test';
import assert from 'node:assert/strict';
import { commissionAmount, membershipAccess, tierInput, referralInput, referralReady, strictObject } from '../lib/subscription-logic.mjs';
const features=[{code:'tracking_binders'},{code:'prices'},{code:'marketplace_sell'}];
const base={user:{role:'user'},features,collectorFeatures:['tracking_binders'],enforce:true,environment:'production',now:Date.parse('2026-09-17T06:00:00Z'),date:'2026-09-17'};
for(const kind of ['legacy_tester','beta_tester']) {
  test(`${kind} survives enforcement, expired subscriptions and lower manual tiers`,()=>{
    const r=membershipAccess({...base,grant:{kind},override:{tier:'collector'},subscription:{environment:'production',paid_through:'2020-01-01',offer_snapshot:{plan_code:'collector'}}});
    assert.equal(r.tier,'complimentary');assert.equal(r.payment_required,false);assert.equal(r.features.length,3);
  });
}
test('administrator retains full access without acquiring a paid subscription',()=>assert.equal(membershipAccess({...base,user:{role:'admin'}}).reason,'administrator'));
test('hidden complimentary grant is full access but does not change an authentication role',()=>{const user={role:'user'},r=membershipAccess({...base,user,override:{tier:'complimentary'}});assert.equal(r.tier,'complimentary');assert.equal(user.role,'user');assert.equal(r.features.length,3)});
for(const tier of ['collector','plus'])test(`manual ${tier} is independent of Stripe charges`,()=>{const r=membershipAccess({...base,override:{tier}});assert.equal(r.tier,tier);assert.equal(r.reason,'administrator_assignment');assert.equal(r.features.length,tier==='plus'?3:1)});
test('expired manual access does not bypass enforcement',()=>assert.equal(membershipAccess({...base,override:{tier:'plus',expires_at:'2020-01-01'}}).allowed,false));
test('unenforced evaluation keeps all existing capabilities',()=>assert.equal(membershipAccess({...base,enforce:false}).features.length,3));
test('Stripe access uses the exact paid timestamp',()=>{const sub={provider:'stripe',environment:'production',offer_snapshot:{plan_code:'plus'},paid_through:'2026-09-17T06:00:01Z'};assert.equal(membershipAccess({...base,subscription:sub}).reason,'stripe_subscription');assert.equal(membershipAccess({...base,now:Date.parse(sub.paid_through),subscription:sub}).allowed,false)});
test('sandbox payment cannot unlock live access',()=>assert.equal(membershipAccess({...base,subscription:{provider:'stripe',environment:'sandbox',paid_through:'2099-01-01',offer_snapshot:{plan_code:'plus'}}}).allowed,false));
test('legacy paid dates remain exclusive and read-only',()=>{const s={provider:'legacy',environment:'production',paid_through:'2026-09-18',offer_snapshot:{plan_code:'collector'}};assert.equal(membershipAccess({...base,subscription:s}).reason,'legacy_paid_period');assert.equal(membershipAccess({...base,date:'2026-09-18',subscription:s}).allowed,false)});
test('arbitrary plan metadata cannot create an entitlement',()=>assert.equal(membershipAccess({...base,subscription:{provider:'stripe',environment:'production',paid_through:'2099-01-01',offer_snapshot:{plan_code:'admin'}}}).allowed,false));
test('tier assignment requires explicit billing acknowledgement',()=>assert.throws(()=>tierInput({tier:'plus',revision:0,reason:'Test grant'})));
test('complimentary access cannot acquire an expiry',()=>assert.throws(()=>tierInput({tier:'complimentary',revision:0,reason:'Test grant',confirm_billing_unchanged:true,expires_at:'2099-01-01'})));
test('privilege fields cannot be smuggled into tier updates',()=>assert.throws(()=>tierInput({tier:'plus',revision:0,reason:'Test grant',confirm_billing_unchanged:true,role:'admin'})));
test('referral approval is distinct from opt-in and consent must match current terms',()=>{const p={status:'approved',revision:2,opted_in_revision:1,opted_in_at:new Date()};assert.equal(referralReady(p),false);assert.equal(referralReady({...p,opted_in_revision:2}),true);assert.equal(referralReady({...p,status:'suspended',opted_in_revision:2}),false)});
test('referral percentages cannot exceed 100%',()=>assert.throws(()=>referralInput({status:'approved',reward_type:'percentage',reward_value:10001,max_payments:1,hold_days:30,terms:'Test referral conditions requiring administrator approval.',revision:0})));
const invoice={settled:true,disputed:false,refund_pending:false,total_minor:1100,tax_minor:100,paid_minor:1100,refunded_minor:0};
test('percentage rewards exclude tax and preserve exact cents',()=>assert.equal(commissionAmount(invoice,{reward_type:'percentage',reward_value:2000}),200));
test('partial refunds reduce percentage rewards',()=>assert.equal(commissionAmount({...invoice,refunded_minor:550},{reward_type:'percentage',reward_value:2000}),100));
test('fixed rewards are capped at net subscription revenue',()=>assert.equal(commissionAmount(invoice,{reward_type:'fixed',reward_value:100000}),1000));
test('fixed rewards reduce proportionally with refunds',()=>assert.equal(commissionAmount({...invoice,refunded_minor:550},{reward_type:'fixed',reward_value:200}),100));
for(const change of [{settled:false},{disputed:true},{refund_pending:true},{refunded_minor:1100},{paid_minor:-1},{tax_minor:1200}])test(`ineligible revenue earns no reward: ${JSON.stringify(change)}`,()=>assert.equal(commissionAmount({...invoice,...change},{reward_type:'percentage',reward_value:2000}),0));
test('sandbox earnings cannot become payable commissions',()=>assert.equal(commissionAmount(invoice,{reward_type:'percentage',reward_value:2000},'sandbox'),0));
test('unknown fields are rejected rather than assigned to trusted objects',()=>assert.throws(()=>strictObject({enabled:true,role:'admin'},['enabled'])));
