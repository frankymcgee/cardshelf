<script setup lang="ts">
const props = defineProps<{ units?: Record<string, string>; path: string; grid?: boolean; marketplace?: boolean; preview: boolean; nonce: string; allowed: () => boolean }>()
const emit = defineEmits<{ requested: [] }>()
const cleanPath = computed(() => props.path.split('?')[0]?.replace(/\/$/, '') || '/')
const layout = computed(() => props.grid || props.marketplace ? 'grid' : cleanPath.value === '/pricing' || cleanPath.value.startsWith('/explore/') ? 'rectangle' : 'banner')
const rail = computed(() => !props.grid && !props.marketplace && ['/', '/features'].includes(cleanPath.value))
const railClosed = ref(false)
</script>
<template>
  <aside :id="preview ? 'cardshelf-placement-preview' : undefined" class="adsterra-placement" :class="{ 'adsterra-grid': grid || marketplace }" aria-label="Advertisements">
    <AdsterraUnit :units="units" :layout="layout" :preview="preview" :nonce="nonce" :allowed="allowed" @requested="emit('requested')" />
  </aside>
  <aside v-if="rail && !railClosed" class="adsterra-rail" aria-label="Side advertisement">
    <button type="button" class="adsterra-rail-close" aria-label="Close side advertisement" @click="railClosed = true">×</button>
    <AdsterraUnit :units="units" layout="rail" :preview="preview" :nonce="nonce" :allowed="allowed" @requested="emit('requested')" />
  </aside>
</template>
<style scoped>
.adsterra-placement{min-width:0;width:100%;margin:32px auto}.adsterra-grid{margin:0;align-self:start}.adsterra-rail{display:none}.adsterra-rail-close{border:1px solid var(--line,#ddd);border-radius:6px;display:block;margin-left:auto;width:28px;height:28px;background:var(--paper,#fff);color:var(--ink,#333);cursor:pointer;font-size:20px}
@media(min-width:1800px) and (min-height:500px){.adsterra-rail{display:block;position:fixed;right:16px;top:110px;width:160px;z-index:25}}
@media print{.adsterra-placement,.adsterra-rail{display:none}}
</style>
