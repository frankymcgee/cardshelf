<script setup lang="ts">
const props = defineProps<{ unit?: any; card?: any }>()
const face = computed(() => props.unit?.card || props.card)
const stage = computed(() => ({ Stage1: 'Stage 1', Stage2: 'Stage 2', MegaEvolution: 'Mega Evolution' } as Record<string, string>)[face.value?.stage] || face.value?.stage)
const maxHp = computed(() => props.unit?.effective_hp ?? face.value?.hp)
const retreat = computed(() => props.unit?.effective_retreat ?? face.value?.retreat)
</script>
<template>
  <div v-if="face" class="arena-card-facts">
    <div class="arena-card-badges" aria-label="Card classification"><span v-if="stage">{{ stage }}</span><span v-else>{{ face.program?.trainerType || (face.basic_energy ? 'Basic Energy' : face.kind) }}</span><span v-if="face.rule_box" class="arena-rule-badge" :aria-label="'Rule box: ' + face.rule_box">{{ face.rule_box }}</span><span v-if="face.prizes > 1">{{ face.prizes }} Prize cards on Knock Out</span></div>
    <dl v-if="face.hp" class="arena-card-stats"><div><dt>{{ unit?.effective_hp !== undefined ? 'Effective HP' : 'HP' }}</dt><dd>{{ Math.max(0, maxHp - (unit?.damage || 0)) }} / {{ maxHp }}<small v-if="maxHp !== face.hp">Printed {{ face.hp }}</small></dd></div><div><dt>{{ unit?.effective_retreat !== undefined ? 'Effective retreat' : 'Retreat' }}</dt><dd>{{ retreat === 0 ? 'Free' : retreat + ' Energy' }}<small v-if="retreat !== face.retreat">Printed {{ face.retreat }}</small></dd></div></dl>
    <p v-if="face.evolves_from" class="arena-muted">Evolves from {{ face.evolves_from }}.</p>
    <p v-if="face.program?.text">{{ face.program.text }}</p>
    <div v-for="(ability, index) in face.abilities || []" :key="index" class="arena-ability-info"><span class="arena-kicker">ABILITY</span><strong>{{ ability.name }}</strong><p>{{ ability.text }}</p><small v-if="ability.limit === 'turn'">Once during your turn, when legal.</small></div>
    <details v-if="face.rules?.length" class="arena-card-rules"><summary>Printed card rules</summary><p v-for="(rule, index) in face.rules" :key="index">{{ rule }}</p></details>
  </div>
</template>
