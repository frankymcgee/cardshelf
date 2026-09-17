<script setup lang="ts">
const api=useApi(), data=ref<any>(null), error=ref('')
const free=computed(()=>Boolean(data.value?.grant ||
  ['complimentary','administrator'].includes(data.value?.access?.reason)))
async function load(){error.value='';try{data.value=await api('/api/account/membership')}catch(e){error.value=errorMessage(e)}}
onMounted(load)
useSeoMeta({title:'Your membership · CardShelf',robots:'noindex, nofollow'})
</script>
<template>
<main class="membership-page">
  <header class="page-heading"><div><span class="eyebrow">YOUR MEMBERSHIP</span><h1>A home for every collector.</h1><p>Choose your level of detail. Manage subscription payments securely with Stripe.</p></div><NuxtLink to="/account" class="button secondary">Your account</NuxtLink></header>
  <p v-if="error" class="alert error" role="alert">{{error}} <button class="text-button" @click="load">Try again</button></p>
  <section v-if="data" class="panel settings-panel"><div class="section-heading"><h2>Your access</h2><span class="badge">{{data.access.allowed?(free?'Protected · no payment required':'Active access'):'Membership required'}}</span></div><p>{{data.message}}</p><p v-if="data.grant" class="small muted">Your tester grant has no automatic expiry. Enabling subscriptions does not remove it.</p><p v-if="!data.access.enforcement_enabled" class="small muted">Membership restrictions are currently disabled during testing.</p><NuxtLink to="/referrals" class="text-button">Your referrals</NuxtLink></section>
  <StripeMembership v-if="data" :free="free" @updated="load" />
  <p class="small muted spaced">CardShelf handles platform subscriptions only. Card-sale payments are arranged between collectors, and referral payouts are recorded separately. Pausing new sign-ups does not cancel existing renewals.</p>
</main>
</template>
<style src="~/assets/css/membership.css"></style>
