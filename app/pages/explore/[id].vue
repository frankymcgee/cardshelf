<script setup lang="ts">
import { gameName } from '../../../shared/games.mjs'
definePageMeta({ layout: 'marketing' })
const route = useRoute(), api = useApi(), card = ref<any>(null), error = ref(''), back = ref(false)
let sequence = 0, alive = true
useSeoMeta({ robots: 'index, follow', title: () => card.value ? card.value.name + ' · Free card catalogue · CardShelf' : 'Free card catalogue · CardShelf' })
async function load() {
  const request = ++sequence; error.value = ''; card.value = null; back.value = false
  try { const result = await api('/api/public/catalogue/cards/' + encodeURIComponent(String(route.params.id))); if (alive && request === sequence) card.value = result }
  catch (e) { if (alive && request === sequence) error.value = errorMessage(e) }
}
watch(() => route.params.id, load, { immediate: true })
onBeforeUnmount(() => { alive = false; sequence++ })
</script>
<template><div class="m-container free-catalogue"><NuxtLink :to="'/explore?game=' + (card?.game || 'pokemon')" class="m-text-link">← Back to catalogue</NuxtLink><p v-if="error" class="alert warning">{{ error }}</p><article v-if="card" class="public-card-detail"><div class="public-card-art"><CardArtwork :card="back ? { ...card, image_url: card.back_image_url } : card" :badges="false" :low="false" effects-mode="off" /><button v-if="card.back_image_url" class="button secondary" @click="back = !back">{{ back ? 'Show front' : 'Show reverse face' }}</button></div><div><span class="m-eyebrow">{{ gameName(card.game) }} · {{ card.language.toUpperCase() }}</span><h1>{{ card.name }}</h1><p>{{ card.set_name }} · #{{ card.local_id }} · {{ card.rarity }}</p><p v-if="card.illustrator" class="small">Illustrated by {{ card.illustrator }}</p><div v-if="card.faces.length > 1"><section v-for="(face, i) in card.faces" :key="i"><h3>{{ face.name }}</h3><p class="card-rules-text">{{ face.text }}</p></section></div><p v-else class="card-rules-text">{{ card.rules_text }}</p><p v-if="card.image_note" class="data-note">{{ card.image_note }}</p><PublicCardPrices :card-id="card.id" /><AffiliateLinks placement="catalogue" :card="card" /></div></article><AdSenseSlot :content-ready="!!card && !error" /><SponsorSlot placement="catalogue" /><CatalogueCredits /></div></template>
