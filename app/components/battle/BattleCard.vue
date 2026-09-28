<script setup lang="ts">
import { useCardImage } from '../../composables/useCardImage.mjs'
const props = defineProps<{ item: any; selected?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ select: [item: any] }>()
const { image, imageSource, imageFailed } = useCardImage(computed(() => props.item?.hidden ? null : props.item?.card), ref(false))
</script>
<template>
  <div v-if="item.hidden" class="battle-hidden" aria-label="Face-down opening card">Face-down<br>opening card</div>
  <div v-else class="battle-stack">
    <button type="button" class="battle-table-card" :class="{ selected }" :disabled="disabled" :aria-label="item.card.name + (item.damage ? ', ' + item.damage + ' damage' : '')" :aria-pressed="!!selected" @click="emit('select', item)">
      <img v-if="image" :src="image" :key="image" :data-artwork-source="imageSource" alt="" loading="lazy" referrerpolicy="no-referrer" @error="imageFailed">
      <span v-else class="battle-card-text">{{ item.card.category || 'Card' }}</span>
      <strong>{{ item.card.name }}</strong><small v-if="item.damage">{{ item.damage }} damage</small><small v-if="item.conditions?.length">{{ item.conditions.join(' · ') }}</small>
    </button>
    <div v-if="item.attachments?.length" class="battle-attachments"><button v-for="child in item.attachments" :key="child.token" type="button" :disabled="disabled" @click="emit('select', child)">{{ child.card.name }}</button></div>
  </div>
</template>
