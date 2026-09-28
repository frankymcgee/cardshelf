<script setup lang="ts">
import { useCardImage } from '../composables/useCardImage.mjs'
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ card: any; low?: boolean }>(), { low: true })
const { image, imageSource, imageFailed } = useCardImage(computed(() => props.card), computed(() => props.low))
</script>
<template>
  <img v-if="image" :key="image" v-bind="$attrs" :src="image" :alt="card?.name || card?.card_name || ''" :title="'Artwork: ' + imageSource" :data-artwork-source="imageSource" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="imageFailed" />
  <slot v-else />
</template>
