<script setup lang="ts">
import { printingVisual, namedCardClass } from '../../shared/variant-visuals.mjs'
const props = defineProps<{ name?: string; printing?: any; showUnknown?: boolean }>()
const finish = computed(() => printingVisual(props.printing))
const mechanic = computed(() => namedCardClass(props.name))
</script>
<template>
  <span class="variant-badges">
    <span v-if="printing && (finish.type !== 'unknown' || showUnknown)" class="variant-badge" :class="'finish-' + finish.type">{{ finish.label }}</span>
    <span v-if="mechanic" class="variant-badge card-class-badge" :class="'class-' + mechanic.type">{{ mechanic.label }}</span>
  </span>
</template>
