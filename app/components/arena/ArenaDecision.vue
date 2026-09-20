<script setup lang="ts">
import ArenaCard from './ArenaCard.vue'
const props = defineProps<{ prompt: any; locked?: boolean }>()
const emit = defineEmits<{ choose: [ids: string[]] }>()
const selected = ref<string[]>([])
const signature = computed(() => JSON.stringify([props.prompt?.kind, props.prompt?.options.map((x: any) => x.id), props.prompt?.min, props.prompt?.max]))
watch(signature, () => { selected.value = [] }, { immediate: true })
function toggle(id: string) { if (props.locked || !props.prompt.options.some((option: any) => option.id === id)) return; if (selected.value.includes(id)) selected.value = selected.value.filter(x => x !== id); else if (props.prompt.max === 1) selected.value = [id]; else if (selected.value.length < props.prompt.max) selected.value = [...selected.value, id] }
const valid = computed(() => selected.value.length >= props.prompt.min && selected.value.length <= props.prompt.max)
</script>
<template>
  <section v-if="prompt" class="arena-decision" aria-label="Required game decision" aria-live="polite"><span class="arena-kicker">RESOLVE BEFORE CONTINUING</span><h2>{{ prompt.title }}</h2><p>Select {{ prompt.min === prompt.max ? prompt.min : prompt.min + '–' + prompt.max }} · {{ selected.length }} selected</p><p v-if="prompt.kind === 'prize'" class="arena-prize-instruction">Choose {{ prompt.max }} face-down Prize {{ prompt.max === 1 ? 'card' : 'cards' }}. Their identities remain hidden until you confirm.</p><div class="arena-choice-grid"><button v-for="option in prompt.options" :key="option.id" type="button" class="arena-choice" :class="{ selected: selected.includes(option.id), 'is-facedown': option.hidden }" :disabled="locked" :aria-pressed="selected.includes(option.id)" @click="toggle(option.id)"><span v-if="option.hidden" class="arena-choice-back" aria-hidden="true">CS</span><img v-else-if="option.card?.card?.image_url" :src="option.card.card.image_url" alt="" loading="lazy" referrerpolicy="no-referrer"><span>{{ option.label }}</span><b v-if="selected.includes(option.id)" aria-hidden="true">✓</b></button></div><p v-if="!prompt.options.length">No matching cards are available.</p><button class="arena-button primary" :disabled="locked || !valid" @click="emit('choose', selected)">{{ prompt.kind === 'prize' ? 'Take ' + selected.length + ' Prize ' + (selected.length === 1 ? 'card' : 'cards') : selected.length ? 'Confirm selection' : 'Confirm no selection' }}</button><p class="arena-muted">Only the selected, revealed cards enter the shared history. Hidden cards are not sent to your opponent.</p></section>
</template>
