<script setup lang="ts">
import { printingIncluded } from '../../shared/printing-distribution.mjs'
const props = defineProps<{ binder: any }>()
const extras = computed(() => (props.binder.slots || []).filter((s: any) => !printingIncluded(s, props.binder.printing_scope)))
const unknown = computed(() => (props.binder.slots || []).filter((s: any) => !s.distribution || s.distribution === 'unknown').length)
</script>
<template><div class="data-note" aria-label="Printing scope"><strong>{{ binder.printing_scope === 'regular' ? 'Regular set variants' : 'Includes promos and product exclusives' }}</strong><span v-if="unknown"> · {{ unknown }} {{ unknown === 1 ? 'pocket has' : 'pockets have' }} unconfirmed distribution and count towards completion.</span><details v-if="extras.length"><summary>{{ extras.length }} extra {{ extras.length === 1 ? 'pocket' : 'pockets' }} excluded from completion</summary><p v-for="s in extras" :key="s.position">Pocket {{ s.position + 1 }} · {{ s.name }} · {{ s.label }} <PrintingDistributionBadge :printing="s" /></p><p>These cards stay in the layout. Include promos and product exclusives in Settings to count them.</p></details></div></template>
