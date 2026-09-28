<script setup lang="ts">
import { useCardImage } from '../../composables/useCardImage.mjs'
import { ref, computed } from 'vue'
import { arenaTrainingArt } from '../../../shared/arena-art.mjs'
const props = defineProps<{ alias: string; count: number; top?: any }>()
const trainingArt = computed(() => props.count > 0 && !props.top?.hidden ? arenaTrainingArt(props.top) : undefined)
const emit = defineEmits<{ inspect: [] }>()
// Replace old text immediately; do not show multiple counts during rapid updates.
function removePreviousCount(_element: Element, done: () => void) { done() }
const { image, imageSource, imageFailed } = useCardImage(computed(() => props.count > 0 && !props.top?.hidden ? props.top : null), ref(false))
</script>
<template>
  <button type="button" class="arena-discard-button arena-table-discard" :class="{ 'is-empty': !count }" :aria-label="'Inspect ' + alias + ' discard: ' + count + ' cards'" @click="emit('inspect')">
    <img v-if="image" class="arena-discard-art" :src="image" :key="image" :data-artwork-source="imageSource" alt="" loading="lazy" referrerpolicy="no-referrer" @error="imageFailed">
    <span v-else-if="count > 0" class="arena-discard-face" :class="{ 'has-illustration': !!trainingArt }" aria-hidden="true"><span v-if="trainingArt" class="arena-discard-illustration" :style="trainingArt" />{{ top?.hidden ? 'CS' : top?.name || 'CS' }}</span>
    <Transition name="arena-count" @leave="removePreviousCount"><b :key="count">{{ count }}</b></Transition><span class="arena-discard-caption">Discard ↗</span>
  </button>
</template>
