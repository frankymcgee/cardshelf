<script setup lang="ts">
import { GAMES } from '../../shared/games.mjs'
withDefaults(defineProps<{ modelValue: string; disabled?: boolean; all?: boolean }>(), { disabled: false, all: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template><label class="game-picker">Card game<select :value="modelValue" :disabled="disabled" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"><option v-if="all" value="">All games</option><option v-for="game in GAMES" :key="game.code" :value="game.code">{{ game.name }}</option></select></label></template>
