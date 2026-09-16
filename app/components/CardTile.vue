<script setup lang="ts">
const props = defineProps<{ card: any }>(), emit = defineEmits(['select'])
const broken = ref(false)
watch(() => props.card.image_url, () => { broken.value = false })
function priceText(price: any) { return new Intl.NumberFormat('en-AU', { style: 'currency', currency: price.aud == null ? price.currency : 'AUD' }).format(price.aud ?? price.amount) + (price.aud == null ? ' ' + price.currency : ' AUD') }
const image = computed(() => props.card.image_url?.replace('/high.webp', '/low.webp'))
</script>
<template><button class="card-tile" @click="emit('select', card.id)"><div class="card-picture"><img v-if="image && !broken" :src="image" :alt="card.name" loading="lazy" decoding="async" @error="broken = true" /><div v-else class="card-fallback"><AppIcon name="cards" :size="36" /><span>{{ card.name }}</span><small>Image unavailable</small></div><span v-if="card.quantity > 0" class="owned-badge"><AppIcon name="check" :size="12" />{{ card.quantity }} owned</span><span v-else-if="card.wishlist" class="wish-badge"><AppIcon name="star" :size="14" /></span></div><span class="card-meta"><strong>{{ card.name }}</strong><span>{{ card.set_name }}</span><span v-if="card.price_from" class="card-market-price">From {{ priceText(card.price_from) }}<small v-if="card.price_from.stale || card.price_from.fetch_error">Stale / check details</small></span><small v-else class="muted">Price not available</small><small>#{{ card.local_id }}<span>{{ card.language.toUpperCase() }}</span></small></span></button></template>
