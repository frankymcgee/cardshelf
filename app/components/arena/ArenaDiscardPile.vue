<script setup lang="ts">
import { ref, watch } from 'vue'
const props = defineProps<{ alias: string; count: number; top?: any }>()
const broken = ref(false)
watch(() => props.top?.image_url, () => { broken.value = false })
const emit = defineEmits<{ inspect: [] }>()
// Replace old text immediately; do not show multiple counts during rapid updates.
function removePreviousCount(_element: Element, done: () => void) { done() }
</script>
<template>
  <button type="button" class="arena-discard-button arena-table-discard" :class="{ 'is-empty': !count }" :aria-label="'Inspect ' + alias + ' discard: ' + count + ' cards'" @click="emit('inspect')">
    <img v-if="count > 0 && top?.image_url && !top.hidden && !broken" class="arena-discard-art" :src="top.image_url" alt="" loading="lazy" referrerpolicy="no-referrer" @error="broken = true">
    <span v-else-if="count > 0" class="arena-discard-face" aria-hidden="true">{{ top?.hidden ? 'CS' : top?.name || 'CS' }}</span>
    <Transition name="arena-count" @leave="removePreviousCount"><b :key="count">{{ count }}</b></Transition><span class="arena-discard-caption">Discard ↗</span>
  </button>
</template>
