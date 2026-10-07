<script setup lang="ts">
import { scanAllowanceLabel } from '../../shared/scan-allowances.mjs'
import { planFeatures } from '../../shared/binder-types.mjs'
defineProps<{ planCode: string, allowances?: Record<string, number> }>()
</script>
<template>
  <p class="plan-scan-allowance">
    <template v-if="planFeatures(planCode).some(feature => feature.code === 'collection')">
      <strong>{{ scanAllowanceLabel(allowances?.[planCode]) }}</strong><br>
      <small>When photo scanning is enabled. Shared service budget applies; monthly allowances reset on the first day (UTC).</small>
    </template>
    <template v-else>Photo scanning is not included in this tier.</template>
  </p>
</template>
<style scoped>
.plan-scan-allowance{font-size:14px;line-height:1.6;margin:0 0 12px}
</style>
