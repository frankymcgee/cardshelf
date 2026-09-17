<script setup lang="ts">
const api=useApi(),route=useRoute(),state=ref<any>(null),catalogue=ref<any>({offers:[]}),error=ref(''),notice=ref(''),busy=ref(false)
const chosen=ref(''),consent=ref(false),referral=ref(typeof route.query.ref==='string'?route.query.ref:''),referralConsent=ref(false)
const intent=ref<string>('')
const offer=computed(()=>catalogue.value.offers.find((o:any)=>o.id===chosen.value))
const free=computed(()=>state.value?.grant||['complimentary','administrator'].includes(state.value?.access.reason))
const money=(n:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n/100)
const tierName=(s:string)=>(({collector:'Collector',plus:'Collector Plus',complimentary:'Complimentary · full access'} as Record<string,string>)[s]||'Membership required')
async function load(){error.value='';try{[state.value,catalogue.value]=await Promise.all([api('/api/billing/account'),api('/api/billing/offers')])}catch(e){error.value=errorMessage(e)}}
async function run(action:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';notice.value='';try{await action();await load()}catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
async function subscribe(){if(!offer.value||!consent.value)return;const o=offer.value;intent.value||=crypto.randomUUID();await run(async()=>{
 if(referral.value.trim()){if(!referralConsent.value)throw new Error('Confirm the optional referral disclosure or clear the referral code.');await api('/api/referrals/claim',{method:'POST',body:{code:referral.value.trim(),consent:true}})}
 const result=await api<any>('/api/billing/subscribe',{method:'POST',body:{offer_id:o.id,revision:o.revision,terms_hash:o.terms_hash,request_id:intent.value,consent:true}})
 notice.value=result.message;consent.value=false
})}
async function retry(s:any){await run(async()=>{await api('/api/billing/subscribe',{method:'POST',body:{offer_id:s.offer_snapshot.id,revision:s.offer_snapshot.revision,terms_hash:s.offer_snapshot.terms_hash,request_id:s.request_id,consent:true}});notice.value='The original subscription request was retried without starting a new subscription.'})}
async function cancel(s:any){if(!window.confirm('Cancel future Square renewals? Existing invoices are not refunded or voided by this action.'))return;await run(async()=>{await api(`/api/billing/${s.id}/cancel`,{method:'POST',body:{confirm:true}});notice.value='Cancellation checked with Square. Any paid access remains until its period ends.'})}
watch(chosen,()=>{intent.value='';consent.value=false})
onMounted(load)
useSeoMeta({title:'Membership & billing · CardShelf'})
</script>
<template><main class="membership-page">
<header class="page-heading"><div><span class="eyebrow">YOUR MEMBERSHIP</span><h1>Choose your collecting experience.</h1><p>Membership billing stays with Square or Stripe. Card-sale payments stay between collectors.</p></div><NuxtLink to="/account" class="button secondary">Your account</NuxtLink></header>
<p v-if="error" class="alert error" role="alert">{{error}}</p><p v-if="notice" class="alert info" role="status">{{notice}}</p>
<section v-if="state" class="panel settings-panel"><div class="section-heading"><h2>{{tierName(state.access.tier)}}</h2><span class="badge">{{state.environment==='sandbox'?'Sandbox · not live billing':'Production billing'}}</span></div>
<p v-if="free" class="alert info">Your full testing or complimentary access is protected. You do not need to buy a subscription.</p>
<p v-else-if="!state.enforcement_enabled" class="muted">Membership enforcement is off. Full beta access remains available while subscriptions are tested.</p>
<p v-else>{{state.access.allowed?'Your membership features are available.':'Subscribe to unlock new collector actions. Your existing records remain readable and exportable.'}}</p>
<div class="account-benefits"><p v-for="f in state.access.features" :key="f.code"><AppIcon name="check" :size="17"/>{{f.label}}</p></div>
</section>
<StripeMembership v-if="state" :free="Boolean(free)" @updated="load" />
<section class="panel settings-panel spaced"><h2>Square subscriptions</h2><p class="muted">Square sends recurring invoices to your account email. Enter payment details only on Square’s hosted invoice page. CardShelf does not collect card numbers, charge for card sales, or send referral payouts.</p>
<p v-if="state?.environment==='sandbox'" class="alert info">Sandbox uses synthetic customer details, not your real profile. Use the invoice link and Square test payment values only; do not enter a real card.</p>
<p v-if="!catalogue.enabled" class="alert info">Subscription purchasing is not enabled on this server. Full testing access remains available. Existing Square subscriptions continue until cancelled.</p>
<template v-else-if="!free">
<p v-if="!catalogue.offers.length" class="muted">The administrator has not published an offer yet.</p>
<div class="membership-offers"><label v-for="o in catalogue.offers" :key="o.id" class="membership-offer" :class="{selected:chosen===o.id}"><input v-model="chosen" type="radio" :value="o.id" :disabled="busy"><span><strong>{{tierName(o.plan_code)}}</strong><b>{{money(o.total_minor)}} <small>/ {{o.cadence==='MONTHLY'?'month':'year'}}</small></b><small>Includes {{money(o.total_minor-o.amount_minor)}} configured tax.</small></span></label></div>
<form v-if="offer" @submit.prevent="subscribe" class="membership-form"><h3>Review the recurring subscription terms</h3><pre class="membership-terms">{{offer.terms}}</pre>
<label>Referral code (optional)<input v-model="referral" maxlength="24" autocomplete="off" :disabled="busy" placeholder="An approved referrer’s code"></label>
<label v-if="referral.trim()" class="membership-check"><input v-model="referralConsent" type="checkbox" :disabled="busy">I agree to use this referral. Its owner may receive an administrator-set commission from my subscription payments.</label>
<label class="membership-check"><input v-model="consent" type="checkbox" required :disabled="busy">I accept these terms and request a recurring {{money(offer.total_minor)}} {{offer.cadence==='MONTHLY'?'monthly':'annual'}} subscription. Square will issue invoices until I cancel.</label>
<button class="button primary" :disabled="busy||!consent">{{busy?'Requesting…':state.environment==='sandbox'?'Create sandbox subscription':'Request Square subscription invoice'}}</button>
</form></template>
</section>
<section v-if="state?.subscriptions.length" class="panel settings-panel spaced"><h2>Your subscription history</h2><article v-for="s in state.subscriptions" :key="s.id" class="membership-history"><div><strong>{{tierName(s.offer_snapshot.plan_code)}}</strong><span class="badge">{{s.status}}</span><p>{{money(s.offer_snapshot.total_minor)}} / {{s.offer_snapshot.cadence==='MONTHLY'?'month':'year'}}</p><p class="small">{{s.paid_through?'Verified access until '+s.paid_through+' (exclusive)':'Awaiting verified invoice payment.'}}<br><span v-if="s.canceled_date">Square cancellation date: {{s.canceled_date}}</span></p><p v-if="s.last_error" class="alert error">{{s.last_error}}</p></div><div class="button-row">
<a v-if="s.invoice_url" :href="s.invoice_url" target="_blank" rel="noopener noreferrer" class="button primary">View invoice on Square</a>
<button v-if="!s.confirmed" class="button secondary" :disabled="busy" @click="retry(s)">Retry original request</button>
<button v-else class="button secondary" :disabled="busy" @click="run(()=>api(`/api/billing/${s.id}/sync`,{method:'POST',body:{}}))">Refresh payment status</button>
<button v-if="s.current&&s.confirmed&&!s.canceled_date" class="button secondary" :disabled="busy" @click="cancel(s)">Cancel renewals</button></div></article></section>
<div class="button-row spaced"><NuxtLink to="/referrals" class="button secondary">Referral programme</NuxtLink><NuxtLink to="/early-access" class="text-button">Contact the administrator</NuxtLink></div>
</main></template>
<style src="~/assets/css/membership.css"></style>
