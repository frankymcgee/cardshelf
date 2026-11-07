<script setup lang="ts">
defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template><div><label>Printings to count<select :value="modelValue" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"><option value="regular">Regular set variants</option><option value="all">Include promos and product exclusives</option></select></label><p class="data-note">Regular set variants exclude confirmed promotional and product-exclusive printings. Unconfirmed distribution stays included for review. Changing this setting keeps existing pockets and ownership.</p></div></template>
