<script setup lang="ts">
withDefaults(defineProps<{ title: string; hint?: string; open?: boolean }>(), { hint: '', open: false })
</script>
<template>
  <details class="ui-disclosure" :open="open">
    <summary><span>{{ title }}</span><small v-if="hint">{{ hint }}</small></summary>
    <div class="disclosure-content"><slot /></div>
  </details>
</template>
<style scoped>
.ui-disclosure{min-width:0;border-top:1px solid var(--line);margin-top:14px}
summary{min-height:44px;display:list-item;list-style-position:inside;padding:12px 0;cursor:pointer;font-size:13px;font-weight:650;color:var(--ink);overflow-wrap:anywhere}
summary small{font-size:11px;color:var(--muted);font-weight:400;margin-left:10px}
summary:focus-visible{outline:2px solid var(--primary);outline-offset:3px;border-radius:4px}
.disclosure-content{padding:4px 0 12px;min-width:0}
</style>
