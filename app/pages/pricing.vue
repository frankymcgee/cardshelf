<script setup lang="ts">
import { CURRENT_FEATURES } from '../../shared/platform.mjs'
import type { PricingOffer } from '../../shared/pricing-table.mjs'
definePageMeta({ layout: 'marketing' })
useMarketingSeo('Collector & Collector Plus', 'Find your collecting plan. Explore current subscription products, features and monthly or annual prices. Existing testing access is protected.', '/pricing')
const { data: billing } = await useFetch<{ enabled: boolean, environment?: string, offers: PricingOffer[] }>('/api/public/subscription-offers', { default: () => ({ enabled: false, offers: [] }) })
const live = computed(() => billing.value?.enabled === true && billing.value?.environment === 'production')
</script>
<template>
<section class="m-container m-page-hero"><span class="m-eyebrow">PLANS & ACCESS</span><h1>Your collection.<br><em>Your level of detail.</em></h1><p class="m-lead">Choose the collecting experience that fits you. Existing invited testers keep their full access, with no payment required.</p></section>
<SubscriptionPricingTable :offers="live ? billing?.offers || [] : []" :mode="live ? 'live' : 'paused'" />
<section class="m-container m-plan-footnote"><h2>Already testing? Keep everything.</h2><p>Existing invited testers retain all {{CURRENT_FEATURES.length}} current feature groups, including both binder types. Their testing grants have no automatic expiry and stay separate from paid subscriptions. Syncing or publishing an offer does not subscribe, charge or downgrade an existing tester.</p><p>Card-sale payments are arranged directly between collectors. Stripe handles platform subscription payments only.</p><NuxtLink to="/login" class="m-text-link">Back to your collection<AppIcon name="arrow" :size="18"/></NuxtLink></section>
</template>
