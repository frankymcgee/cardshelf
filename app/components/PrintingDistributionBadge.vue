<script setup lang="ts">
import { distributionLabel } from '../../shared/printing-distribution.mjs'
defineProps<{ printing: any }>()
</script>
<template><span class="badge" :class="printing?.distribution === 'regular' ? 'green' : printing?.distribution === 'unknown' || !printing?.distribution ? 'amber' : 'purple'">{{ distributionLabel(printing) }}</span></template>
