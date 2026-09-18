<script setup lang="ts">
const { mode, ready, setMode } = useTheme()
function change(event: Event) { setMode((event.target as HTMLSelectElement).value) }
</script>
<template>
  <label class="theme-picker no-print">
    <span>Theme</span>
    <select :value="mode" :disabled="!ready" aria-label="Colour theme" @change="change">
      <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
    </select>
  </label>
</template>
<style scoped>
.theme-picker{display:flex;align-items:center;gap:9px;margin:10px 0;font-size:11px;color:var(--muted);font-weight:600;min-width:0}
.theme-picker select{width:auto;min-width:96px;margin:0;min-height:36px;padding:7px 25px 7px 10px;font-size:12px;background:var(--paper);color:var(--ink);border-color:var(--line)}
@media(max-width:400px){.theme-picker>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.theme-picker{gap:0}.theme-picker select{min-width:88px}}
</style>
