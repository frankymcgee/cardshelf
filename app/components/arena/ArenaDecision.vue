<script setup lang="ts">
import CardImage from '../CardImage.vue'
const props = defineProps<{ prompt: any; locked?: boolean }>()
const emit = defineEmits<{ choose: [ids: string[]] }>()
const selected = ref<string[]>([])
const signature = computed(() => JSON.stringify([props.prompt?.kind, props.prompt?.options.map((x: any) => x.id), props.prompt?.min, props.prompt?.max, props.prompt?.retreat_cost, props.prompt?.allowed_counts]))
watch(signature, () => { selected.value = [] }, { immediate: true })
function toggle(id: string) { if (props.locked || !props.prompt.options.some((option: any) => option.id === id)) return; if (selected.value.includes(id)) selected.value = selected.value.filter(x => x !== id); else if (props.prompt.max === 1) selected.value = [id]; else if (selected.value.length < props.prompt.max) selected.value = [...selected.value, id] }
const selectedEnergy = computed(() => selected.value.reduce((n, id) => n + (props.prompt.options.find((o: any) => o.id === id)?.energy_value || 1), 0))
const valid = computed(() => selected.value.length >= props.prompt.min && selected.value.length <= props.prompt.max
  && (!props.prompt.allowed_counts || props.prompt.allowed_counts.includes(selected.value.length))
  && (props.prompt.retreat_cost === undefined || selectedEnergy.value >= props.prompt.retreat_cost
    && selected.value.every(id => selectedEnergy.value - (props.prompt.options.find((o: any) => o.id === id)?.energy_value || 1) < props.prompt.retreat_cost)))
</script>
<template>
  <section v-if="prompt" class="arena-decision" aria-label="Required game decision" aria-live="polite">
    <span class="arena-kicker">RESOLVE BEFORE CONTINUING</span><h2>{{ prompt.title }}</h2>
    <p>Select {{ prompt.min === prompt.max ? prompt.min : prompt.min + '–' + prompt.max }} · {{ selected.length }} selected</p>
    <p v-if="prompt.allowed_counts">Choose {{ prompt.allowed_counts.join(' or ') }} cards; a partial optional cost is not allowed.</p>
    <p v-if="prompt.retreat_cost !== undefined">{{ selectedEnergy }} / {{ prompt.retreat_cost }} Energy provided. Do not discard an unnecessary card.</p>
    <p v-if="prompt.kind === 'prize'" class="arena-prize-instruction">Choose {{ prompt.max }} face-down Prize {{ prompt.max === 1 ? 'card' : 'cards' }}. Their identities remain hidden until you confirm.</p>
    <details v-if="prompt.looked_at?.length"><summary>Cards you looked at — private to you</summary><div class="arena-choice-grid"><figure v-for="unit in prompt.looked_at" :key="unit.id"><CardImage :card="unit.card" alt=""/><figcaption>{{ unit.card.name }}</figcaption></figure></div></details>
    <div class="arena-choice-grid">
      <button v-for="option in prompt.options" :key="option.id" type="button" class="arena-choice" :class="{ selected: selected.includes(option.id), 'is-facedown': option.hidden }" :disabled="locked" :aria-pressed="selected.includes(option.id)" @click="toggle(option.id)">
        <span v-if="option.hidden" class="arena-choice-back" aria-hidden="true">CS</span><CardImage v-else-if="option.card?.card" :card="option.card.card" alt="" />
        <span>{{ option.label }}</span><small v-if="option.energy_value">Provides {{ option.energy_value }} Energy</small><small v-if="option.protected">Protected from this attack effect</small><b v-if="selected.includes(option.id)" aria-hidden="true">✓</b>
      </button>
    </div>
    <p v-if="!prompt.options.length">No matching cards are available.</p>
    <button class="arena-button primary" :disabled="locked || !valid" @click="emit('choose', selected)">{{ prompt.kind === 'prize' ? 'Take ' + selected.length + ' Prize ' + (selected.length === 1 ? 'card' : 'cards') : selected.length ? 'Confirm selection' : 'Confirm no selection' }}</button>
    <p class="arena-muted">The server reveals only what the card effect requires. Private searches, viewed cards and face-down choices are not sent to your opponent.</p>
  </section>
</template>
