<script setup lang="ts">
import { scanAllowanceLabel } from '../../shared/scan-allowances.mjs'
defineProps<{ planCode: string, allowances?: Record<string, number> }>()
</script>
<template>
  <p class="plan-scan-allowance">
    <strong>{{ scanAllowanceLabel(allowances?.[planCode]) }}</strong><br>
    <small>Requires collection access and enabled photo scanning. Shared service budget applies; monthly allowances reset on the first day (UTC).</small>
  </p>
</template>
<style scoped>
.plan-scan-allowance{font-size:14px;line-height:1.6;margin:0 0 12px}
</style>
