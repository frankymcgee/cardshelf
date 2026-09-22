<script setup lang="ts">
defineProps<{ alias: string; count: number }>()
const emit = defineEmits<{ inspect: [] }>()
</script>
<template>
  <button type="button" class="arena-discard-button arena-table-discard" :class="{ 'is-empty': !count }" :aria-label="'Inspect ' + alias + ' discard: ' + count + ' cards'" @click="emit('inspect')">
    <b>{{ count }}</b><span>Discard ↗</span>
  </button>
</template>
