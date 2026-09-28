<script setup lang="ts">
import { printingVisual, namedCardClass, singlePrinting, foilTreatment } from '../../shared/variant-visuals.mjs'
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
const foil = computed(() => foilTreatment(props.card, selected.value))
</script>
<template>
  <span class="card-artwork" :data-game="card?.game || 'pokemon'" :data-finish="finish.type" :data-foil="foil" :class="['visual-' + finish.type, 'foil-' + foil, mechanic ? 'visual-class-' + mechanic.type : '', { 'effects-on': effects, 'effects-animated': effectsMode === 'animated' }]">
    <img v-if="image && !broken" :src="image" :alt="card.name" loading="lazy" decoding="async" draggable="false" @error="broken = true" />
    <span v-else class="artwork-fallback"><AppIcon name="cards" :size="28" /><span>{{ card?.name || 'Card' }}</span><small>Image unavailable</small></span>
    <template v-if="effects && image && !broken && foil !== 'none'">
      <span class="foil-layer foil-spectrum" aria-hidden="true" />
      <span class="foil-layer foil-texture" aria-hidden="true" />
      <span class="foil-layer foil-glare" aria-hidden="true" />
    </template>
    <VariantBadges v-if="badges" class="artwork-labels" :name="pokemon ? card?.name : ''" :printing="selected" />
  </span>
</template>
