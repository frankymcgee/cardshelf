import test from 'node:test';
import assert from 'node:assert/strict';
import { stripeInvoiceFacts, stripePrice } from '../lib/stripe-logic.mjs';
import { checkoutTax } from '../lib/stripe-tax.mjs';
import { commissionAmount } from '../lib/subscription-logic.mjs';
import { stripeFixture } from './helpers/stripe-fixtures.mjs';
function fixture(behavior='exclusive',tax=100) {
  const f=stripeFixture('production');
  f.offer={...stripePrice(f.price,'production'),tax_mode:'automatic',tax_behavior:behavior};
  f.line.amount=1000;f.invoice.subtotal=1000;
  f.invoice.total=behavior==='inclusive'?1000:1000+tax;
  f.invoice.total_excluding_tax=f.invoice.total-tax;
  f.invoice.subtotal_excluding_tax=f.invoice.total_excluding_tax;
  f.invoice.amount_paid=f.invoice.amount_due=f.invoice.payments.data[0].amount_paid=f.intent.amount_received=f.charge.amount=f.invoice.total;
  f.invoice.automatic_tax={enabled:true,status:'complete',liability:{type:'self'}};f.sub.automatic_tax={enabled:true,liability:{type:'self'}};
  f.invoice.issuer={type:'self'};f.invoice.total_taxes=[{amount:tax,tax_behavior:behavior,type:'tax_rate_details'}];
  return f;
}
const facts=f=>stripeInvoiceFacts(f.invoice,f.sub,f.offer,f.intent,f.charge,f.refunds);
for(const behavior of ['inclusive','exclusive'])for(const tax of [0,100,200])test(`verified ${behavior} invoice supports ${tax} cents actual tax`,()=>{
  const f=fixture(behavior,tax),r=facts(f);assert.equal(r.supported,true);assert.equal(r.settled,true);assert.equal(r.tax_minor,tax);assert.equal(r.paid_minor,f.invoice.total);
});
const unsupported=[
 ['failed calculation',f=>f.invoice.automatic_tax.status='failed'],['disabled invoice tax',f=>f.invoice.automatic_tax.enabled=false],
 ['disabled subscription tax',f=>f.sub.automatic_tax.enabled=false],['missing breakdown',f=>f.invoice.total_taxes=null],
 ['wrong tax sum',f=>f.invoice.total_taxes[0].amount=99],['wrong behavior',f=>f.invoice.total_taxes[0].tax_behavior='inclusive'],
 ['invalid type',f=>f.invoice.total_taxes[0].type='unknown'],['wrong base',f=>f.line.amount=900],['wrong subtotal',f=>f.invoice.subtotal=1200],
 ['Connect liability',f=>f.invoice.automatic_tax.liability={type:'account',account:'acct_other'}],['foreign issuer',f=>f.invoice.issuer={type:'account'}],
 ['manual tax rate',f=>f.invoice.default_tax_rates=[{id:'txr_manual'}]],['subscription manual tax',f=>f.sub.default_tax_rates=['txr_manual']],
 ['shipping',f=>f.invoice.shipping_cost={}],['shipping amount',f=>f.invoice.amount_shipping=10],
 ['discount',f=>f.invoice.total_discount_amounts=[{amount:10}]],['line discount',f=>f.line.discount_amounts=[{amount:10}]],
 ['credit note',f=>f.invoice.post_payment_credit_notes_amount=10],['balance credit',f=>f.invoice.starting_balance=-100],
 ['extra item',f=>f.invoice.lines.data.push({...f.line})],['wrong price',f=>f.line.pricing.price_details.price='price_other'],
 ['proration',f=>f.line.parent.subscription_item_details.proration=true],['incorrect period',f=>f.line.period.end--]
];
for(const [name,change]of unsupported)test('automatic tax still rejects '+name,()=>{const f=fixture();change(f);assert.equal(facts(f).supported,false)});
for(const [name,change]of [
 ['unpaid invoice',f=>f.invoice.status='open'],['uncaptured card',f=>f.charge.captured=false],['offline invoice',f=>f.invoice.payments.data=[]],
 ['incorrect customer',f=>f.charge.customer='cus_other'],['wrong currency',f=>f.intent.currency='usd'],['partial payment',f=>f.intent.amount_received=500],
 ['unpaid payment record',f=>f.invoice.payments.data[0].status='open']
])test('tax support does not weaken payment verification: '+name,()=>{const f=fixture();change(f);assert.equal(facts(f).settled,false)});
test('an arbitrary total cannot masquerade as a changed automatic-tax base',()=>{
 const f=fixture();f.invoice.total=9999;f.invoice.total_excluding_tax=9899;assert.equal(facts(f).supported,false);
});
test('refund rewards exclude the actual collected tax and retain exact cents',()=>{
 const f=fixture();f.charge.amount_refunded=550;f.refunds.data=[{charge:f.charge.id,currency:'aud',amount:550,status:'succeeded'}];
 const r=facts(f);assert.equal(r.settled,true);assert.equal(commissionAmount(r,{reward_type:'percentage',reward_value:2000}),100);
 f.charge.amount_refunded=1100;f.refunds.data[0].amount=1100;assert.equal(facts(f).settled,false);
});
test('disputes and pending refunds do not generate payable rewards',()=>{
 const f=fixture();f.charge.disputed=true;assert.equal(commissionAmount(facts(f),{reward_type:'fixed',reward_value:100}),0);
 f.charge.disputed=false;f.refunds.data=[{charge:f.charge.id,currency:'aud',status:'pending'}];assert.equal(commissionAmount(facts(f),{reward_type:'fixed',reward_value:100}),0);
});
test('existing fixed/no-tax snapshots keep their original invoice contract',()=>{
 const f=stripeFixture();f.offer=stripePrice(f.price,'sandbox');assert.equal(facts(f).settled,true);f.invoice.total=1001;assert.equal(facts(f).settled,false);
});
test('automatic tax collects address on hosted Checkout only',()=>{
 assert.deepEqual(checkoutTax({tax_mode:'automatic'}),{automatic_tax:{enabled:true},billing_address_collection:'required',customer_update:{address:'auto'}});
 assert.deepEqual(checkoutTax({tax_mode:'fixed'}),{automatic_tax:{enabled:false}});
});
