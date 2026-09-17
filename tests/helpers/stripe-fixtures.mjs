// Synthetic provider contracts only. Never use real credentials or make financial API calls.
export function stripeFixture(environment='sandbox',request='00000000-0000-4000-8000-000000000001') {
  const live=environment==='production',a=new Date();a.setUTCDate(1);a.setUTCHours(0,0,0,0);const end=new Date(a);end.setUTCMonth(end.getUTCMonth()+1);
  const price={id:'price_fixture',object:'price',active:true,livemode:live,currency:'aud',type:'recurring',billing_scheme:'per_unit',unit_amount:1000,recurring:{interval:'month',interval_count:1,usage_type:'licensed'},product:{id:'prod_fixture',name:'Collector fixture'}};
  const sub={id:'sub_fixture',object:'subscription',livemode:live,customer:'cus_fixture',metadata:{cardshelf_request:request},status:'active',billing_cycle_anchor:a.getTime()/1000,cancel_at_period_end:false,items:{data:[{price,quantity:1}]}};
  const line={id:'il_fixture',quantity:1,parent:{subscription_item_details:{subscription:sub.id,proration:false}},pricing:{price_details:{price:price.id}},period:{start:a.getTime()/1000,end:end.getTime()/1000}};
  const invoice={id:'in_fixture',object:'invoice',customer:'cus_fixture',livemode:live,currency:'aud',status:'paid',billing_reason:'subscription_create',parent:{subscription_details:{subscription:sub.id}},total:1000,total_excluding_tax:1000,amount_due:1000,amount_paid:1000,amount_remaining:0,lines:{data:[line],has_more:false},payments:{data:[{id:'inpay_fixture',status:'paid',invoice:'in_fixture',amount_paid:1000,payment:{type:'payment_intent',payment_intent:'pi_fixture'}}],has_more:false}};
  const intent={id:'pi_fixture',status:'succeeded',livemode:live,currency:'aud',customer:'cus_fixture',amount_received:1000,latest_charge:'ch_fixture'};
  const charge={id:'ch_fixture',livemode:live,payment_intent:'pi_fixture',customer:'cus_fixture',status:'succeeded',paid:true,captured:true,payment_method_details:{type:'card'},currency:'aud',amount:1000,amount_refunded:0,disputed:false};
  const portal={id:'bpc_fixture',active:true,features:{payment_method_update:{enabled:true},invoice_history:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:false}}};
  const session={id:'cs_fixture',livemode:live,mode:'subscription',client_reference_id:request,customer:'cus_fixture',status:'complete',subscription:sub.id,url:'https://checkout.stripe.com/c/pay/cs_fixture',metadata:{cardshelf_request:request}};
  return {price,sub,line,invoice,intent,charge,portal,session,refunds:{data:[],has_more:false}};
}
