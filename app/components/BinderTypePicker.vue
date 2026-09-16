<script setup lang="ts">
defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template>
  <div class="binder-type-picker" role="group" aria-label="Binder type">
    <button type="button" :disabled="disabled" :aria-pressed="modelValue === 'tracking'" :class="{ selected: modelValue === 'tracking' }" @click="emit('update:modelValue', 'tracking')">
      <span class="type-plan">COLLECTOR</span><strong><AppIcon name="check" :size="19" />Tracking binder</strong>
      <span>A simple checklist. Missing cards stay grey until you mark them collected.</span>
    </button>
    <button type="button" :disabled="disabled" :aria-pressed="modelValue === 'collection'" :class="{ selected: modelValue === 'collection' }" @click="emit('update:modelValue', 'collection')">
      <span class="type-plan">COLLECTOR PLUS</span><strong><AppIcon name="binder" :size="19" />Collection binder</strong>
      <span>The detailed workspace: prices, conditions, custom layouts and wallpapers.</span>
    </button>
  </div>
  <p class="data-note">Both types are available to testers. These are planned memberships; billing remains off.</p>
</template>
<style scoped>
.binder-type-picker{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.binder-type-picker button{display:flex;flex-direction:column;gap:10px;text-align:left;padding:18px;border:1px solid #d8dee8;border-radius:12px;background:#fff;color:#344155;font:inherit;min-width:0;cursor:pointer}.binder-type-picker button.selected{border:2px solid #5546d8;padding:17px;background:#f5f3ff}.binder-type-picker strong{display:flex;gap:7px;align-items:center;font-size:15px}.binder-type-picker button>span:last-child{font-size:12px;line-height:1.6}.type-plan{font-size:10px;letter-spacing:.13em;font-weight:800;color:#63558e}.binder-type-picker button:focus-visible{outline:3px solid #8174e6;outline-offset:3px}.binder-type-picker button:disabled{opacity:.6;cursor:wait}@media(max-width:480px){.binder-type-picker{grid-template-columns:1fr}}
</style>
