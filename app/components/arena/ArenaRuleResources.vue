<script setup lang="ts">
import ArenaModal from './ArenaModal.vue'
import ArenaCard from './ArenaCard.vue'
// Optional Boolean props otherwise coerce missing legacy fields to false,
// incorrectly displaying an unused Power that the old engine never tracked.
const props = withDefaults(defineProps<{ alias: string; gxUsed?: boolean; vstarUsed?: boolean; lostZone?: any[] }>(), { gxUsed: undefined, vstarUsed: undefined })
const emit = defineEmits<{ select: [unit: any] }>()
const open = ref(false)
const cards = computed(() => (props.lostZone || []).filter(unit => unit && !unit.hidden && unit.card))
function inspect(unit: any) { if (cards.value.includes(unit)) { open.value = false; emit('select', unit) } }
</script>
<template>
  <div v-if="gxUsed !== undefined || vstarUsed !== undefined || lostZone !== undefined" class="arena-rule-resources" :aria-label="alias + ' game resources'">
    <small v-if="gxUsed !== undefined">GX: {{ gxUsed ? 'Used' : 'Available' }}</small>
    <small v-if="vstarUsed !== undefined">VSTAR: {{ vstarUsed ? 'Used' : 'Available' }}</small>
    <button type="button" class="arena-link" @click="open = true">Lost Zone · {{ cards.length }}</button>
    <ArenaModal :open="open" :label="alias + ' · Public Lost Zone'" @close="open = false">
      <p>These cards are out of play and cannot be recovered.</p>
      <div class="arena-discard-grid"><ArenaCard v-for="unit in cards" :key="unit.id" :unit="unit" @select="inspect" /></div>
      <p v-if="!cards.length">No cards in the Lost Zone.</p>
    </ArenaModal>
  </div>
</template>
