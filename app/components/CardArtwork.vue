<script setup lang="ts">
import { printingVisual, namedCardClass, singlePrinting } from '../../shared/variant-visuals.mjs'
const props = withDefaults(defineProps<{ card: any; printing?: any; effectsMode?: string; low?: boolean; badges?: boolean }>(),
  { effectsMode: 'subtle', low: true, badges: true })
const broken = ref(false)
const selected = computed(() => props.printing || singlePrinting(props.card))
const finish = computed(() => printingVisual(selected.value))
const pokemon = computed(() => !props.card?.game || props.card.game === 'pokemon')
const mechanic = computed(() => pokemon.value ? namedCardClass(props.card?.name) : null)
const image = computed(() => props.low ? props.card?.image_url?.replace('/high.webp', '/low.webp') : props.card?.image_url)
watch(image, () => { broken.value = false })
const effects = computed(() => ['subtle', 'animated'].includes(props.effectsMode))
</script>
<template>
  <span class="card-artwork" :data-game="card?.game || 'pokemon'" :data-finish="finish.type" :class="['visual-' + finish.type, mechanic ? 'visual-class-' + mechanic.type : '', { 'effects-on': effects, 'effects-animated': effectsMode === 'animated' }]">
    <img v-if="image && !broken" :src="image" :alt="card.name" loading="lazy" decoding="async" draggable="false" @error="broken = true" />
    <span v-else class="artwork-fallback"><AppIcon name="cards" :size="28" /><span>{{ card?.name || 'Card' }}</span><small>Image unavailable</small></span>
    <span v-if="effects && image && !broken && ['holo','reverse'].includes(finish.type)" class="foil-layer" aria-hidden="true" />
    <VariantBadges v-if="badges" class="artwork-labels" :name="pokemon ? card?.name : ''" :printing="selected" />
  </span>
</template>
