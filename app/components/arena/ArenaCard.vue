<script setup lang="ts">
import { energySymbol } from '../../../shared/arena.mjs'
const props = defineProps<{ unit?: any; card?: any; back?: boolean; selected?: boolean; disabled?: boolean; hit?: boolean; label?: string }>()
const emit = defineEmits<{ select: [unit: any] }>()
const broken = ref(false)
const face = computed<any>(() => props.unit?.card || props.card)
const hidden = computed(() => props.back || props.unit?.hidden || !face.value)
const maxHp = computed(() => props.unit?.effective_hp ?? face.value?.hp ?? 0)
const hp = computed(() => Math.max(0, maxHp.value - (props.unit?.damage || 0)))
const isTraining = computed(() => face.value?.training || String(face.value?.id || '').startsWith('training:'))
watch(() => face.value?.image_url, () => { broken.value = false })
const name = computed(() => props.label || (hidden.value ? 'Face-down card' : `${face.value.name}${face.value.hp ? `, ${hp.value} of ${maxHp.value} HP` : ''}`))
</script>
<template>
  <button type="button" class="arena-card" :class="[{ 'arena-card-back': hidden, 'is-selected': selected, 'is-hit': hit }, 'energy-' + String(hidden ? 'Colorless' : face?.type || 'Colorless').toLowerCase()]" :disabled="disabled || hidden" :aria-label="name" :aria-pressed="selected || false" @click="emit('select', unit || { id: face.id, card: face })">
    <template v-if="hidden"><span class="arena-back-orbit" aria-hidden="true"><i /><b>CS</b></span><span class="arena-back-word">CARDSHELF</span></template>
    <template v-else>
      <img v-if="face.image_url && !broken" class="arena-card-art" :src="face.image_url" :alt="face.name" loading="lazy" referrerpolicy="no-referrer" @error="broken = true">
      <div v-else class="arena-original-card"><div class="arena-original-top"><b>{{ face.name }}</b><small>{{ face.hp ? face.hp + ' HP' : face.kind }}</small></div><div class="arena-original-art" aria-hidden="true"><span>{{ energySymbol(face.type) }}</span><i /><i /></div><div class="arena-original-rules"><small>{{ face.stage || face.program?.trainerType || 'Basic Energy' }}</small><span v-if="face.attacks?.length">{{ face.attacks[0].name }} <b>{{ face.attacks[0].printed || face.attacks[0].damage }}</b></span><span v-else>{{ face.program?.text || 'Attach to power your next move.' }}</span></div><small class="arena-original-credit">{{ isTraining ? 'Original training card' : 'Catalogue artwork unavailable' }}</small></div>
      <span v-if="unit?.damage" class="arena-damage-token">{{ unit.damage }}<small>damage</small></span>
      <span v-if="face.hp && unit" class="arena-hp-track" :aria-label="hp + ' HP remaining'"><i :style="{ width: (Math.min(1, hp / maxHp) * 100) + '%' }" /></span>
      <span v-if="unit?.conditions && (unit.conditions.special || unit.conditions.poison || unit.conditions.burn)" class="arena-condition-tokens"><span v-if="unit.conditions.special">{{ unit.conditions.special }}</span><span v-if="unit.conditions.poison">Poison</span><span v-if="unit.conditions.burn">Burn</span></span>
      <span v-if="face.rule_box" class="arena-rule-token" :aria-label="'Rule box: ' + face.rule_box">{{ face.rule_box }}</span>
      <span v-if="unit?.tools?.length || unit?.under?.length" class="arena-attachment-tokens"><span v-if="unit.tools?.length" :title="unit.tools.map((tool: any) => tool.card.name).join(', ')">Tool {{ unit.tools.length }}</span><span v-if="unit.under?.length" :title="'Evolution stack: ' + unit.under.map((card: any) => card.card.name).join(', ')">↥ {{ unit.under.length }}</span></span>
      <span v-if="unit?.energy?.length" class="arena-energy-tokens"><i v-for="energy in unit.energy" :key="energy.id" :title="energy.card.name">{{ energySymbol(energy.card.type) }}</i></span>
    </template>
  </button>
</template>
