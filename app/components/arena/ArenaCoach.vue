<script setup lang="ts">
import { LESSONS } from '../../../shared/arena.mjs'
const props = defineProps<{ progress: Record<string, boolean>; phase: string }>()
const emit = defineEmits<{ focus: [zone: string] }>()
const manual = ref<number | null>(null)
const current = computed(() => manual.value ?? Math.max(0, LESSONS.findIndex(step => !props.progress[step.id])))
const step = computed(() => LESSONS[current.value] || LESSONS[0]!)
watch(() => step.value.zone, zone => emit('focus', zone), { immediate: true })
</script>
<template><section class="arena-coach"><div class="arena-coach-avatar" aria-hidden="true">CS</div><div><span class="arena-kicker">TRAINING PARTNER · {{ current + 1 }} / {{ LESSONS.length }}</span><h2>{{ step.title }}</h2><p>{{ step.text }}</p><div class="arena-coach-progress"><i v-for="lesson in LESSONS" :key="lesson.id" :class="{ done: progress[lesson.id] }" :title="lesson.title" /></div><div class="arena-coach-controls"><button class="arena-link" :disabled="current <= 0" @click="manual = current - 1">Previous tip</button><button class="arena-link" @click="manual = null">Follow my progress</button><button class="arena-link" :disabled="current >= LESSONS.length - 1" @click="manual = current + 1">Next tip</button></div></div></section></template>
