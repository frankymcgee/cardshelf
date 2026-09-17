<script setup lang="ts">
import { CURRENT_FEATURES } from '../../shared/platform.mjs'
import { planFeatures } from '../../shared/binder-types.mjs'
definePageMeta({ layout: 'marketing' })
useMarketingSeo('Collector & Collector Plus', 'Quick tracking with Collector, or detailed collections, market pricing and custom binders with Collector Plus. Testers keep full access; billing is not active.', '/pricing')
const plans = [{ code: 'collector', name: 'Collector', headline: 'Just collect.', description: 'A card checklist without the paperwork. Generate a set or series binder, then tap to mark each find.' },
  { code: 'plus', name: 'Collector Plus', headline: 'Know every detail.', description: 'Everything in Collector, with the tools to value, organise and personalise your collection.' }]
</script>
<template>
  <section class="m-container m-page-hero"><span class="m-eyebrow">PLANS & ACCESS</span><h1>Your collection.<br><em>Your level of detail.</em></h1><p class="m-lead">Quick tracking or a fully personalised collection workspace. Both are available to our testers today, with no payment required.</p></section>
  <section class="m-container m-plan-grid"><article v-for="plan in plans" :key="plan.code" class="m-plan" :class="plan.code === 'plus' ? 'm-plan-current' : 'm-plan-future'">
    <span class="m-plan-label">PLANNED MEMBERSHIP · NOT ON SALE</span><h2>{{ plan.name }}</h2><p class="m-plan-price">{{ plan.headline }}</p><p>{{ plan.description }}</p>
    <ul><li v-for="feature in planFeatures(plan.code)" :key="feature.code"><AppIcon name="check" :size="18" />{{ feature.label }}</li></ul>
    <p><strong>Pricing to be announced.</strong> No checkout or subscription charges are enabled.</p>
    <NuxtLink to="/early-access" class="m-button">Request testing access<AppIcon name="arrow" :size="18" /></NuxtLink>
  </article></section>
  <section class="m-container m-plan-footnote"><h2>Already testing? Keep everything.</h2><p>Existing and new invited testers retain all {{ CURRENT_FEATURES.length }} current feature groups, including both binder types. Testing access has no automatic expiry and stays separate from future subscription records. These plan definitions do not change your account, remove features or start a trial.</p><NuxtLink to="/login" class="m-text-link">Back to your collection<AppIcon name="arrow" :size="18" /></NuxtLink></section>
</template>
