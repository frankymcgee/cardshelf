<script setup lang="ts">
import { CURRENT_FEATURES } from '../../shared/platform.mjs'
import { planFeatures } from '../../shared/binder-types.mjs'
definePageMeta({ layout: 'marketing' })
useMarketingSeo('Collector & Collector Plus', 'Quick tracking with Collector, or detailed collections, market pricing and custom binders with Collector Plus. Existing testing access is protected.', '/pricing')
const {data:billing}=await useFetch<any>('/api/public/subscription-offers',{default:()=>({enabled:false,offers:[]})})
const live=computed(()=>billing.value?.enabled&&billing.value?.environment==='production')
const plans=[{code:'collector',name:'Collector',headline:'Just collect.',description:'A card checklist without the paperwork. Generate a set or series binder, then tap to mark each find.'},{code:'plus',name:'Collector Plus',headline:'Know every detail.',description:'Everything in Collector, with the tools to value, organise and personalise your collection.'}]
const money=(n:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n/100)
const offers=(code:string)=>(billing.value?.offers||[]).filter((o:any)=>o.plan_code===code)
</script>
<template>
<section class="m-container m-page-hero"><span class="m-eyebrow">PLANS & ACCESS</span><h1>Your collection.<br><em>Your level of detail.</em></h1><p class="m-lead">Quick tracking or a fully personalised collection workspace. Existing invited testers keep both, with no payment required.</p></section>
<section class="m-container m-plan-grid"><article v-for="plan in plans" :key="plan.code" class="m-plan" :class="plan.code==='plus'?'m-plan-current':'m-plan-future'">
<span class="m-plan-label">{{live&&offers(plan.code).length?'PLATFORM MEMBERSHIP':'PLANNED MEMBERSHIP · NOT ON SALE'}}</span><h2>{{plan.name}}</h2><p class="m-plan-price">{{plan.headline}}</p><p>{{plan.description}}</p>
<ul><li v-for="feature in planFeatures(plan.code)" :key="feature.code"><AppIcon name="check" :size="18"/>{{feature.label}}</li></ul>
<template v-if="live&&offers(plan.code).length"><p v-for="o in offers(plan.code)" :key="o.id"><strong>{{money(o.total_minor)}} / {{o.cadence==='MONTHLY'?'month':'year'}}</strong> including configured tax.</p><p>Recurring subscription payments are securely handled by Stripe. Review the full offer and cancellation terms before subscribing.</p><NuxtLink to="/membership" class="m-button">Review membership<AppIcon name="arrow" :size="18"/></NuxtLink></template>
<template v-else><p><strong>Pricing to be announced.</strong> <span v-if="!live">New subscription checkout is paused. Existing renewals are not cancelled.</span><span v-else>There is no published offer for this plan.</span></p><NuxtLink to="/early-access" class="m-button">Request testing access<AppIcon name="arrow" :size="18"/></NuxtLink></template>
</article></section>
<section class="m-container m-plan-footnote"><h2>Already testing? Keep everything.</h2><p>Existing invited testers retain all {{CURRENT_FEATURES.length}} current feature groups, including both binder types. Their testing grants have no automatic expiry and stay separate from paid subscriptions. Publishing an offer does not subscribe, charge or downgrade an existing tester.</p><p>Card-sale payments are arranged directly between collectors. Stripe handles platform subscription payments only.</p><NuxtLink to="/login" class="m-text-link">Back to your collection<AppIcon name="arrow" :size="18"/></NuxtLink></section>
</template>
