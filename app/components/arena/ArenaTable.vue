<script setup lang="ts">
defineProps<{ focusZone?: string }>()
</script>
<template>
  <div class="arena-board arena-table" data-layout="opposite-table" :data-focus-zone="focusZone || ''"><slot /></div>
</template>
<style src="~/assets/css/arena-table.css"></style>
<style src="~/assets/css/arena-interactions.css"></style>
