<script setup lang="ts">
defineProps<{ focusZone?: string }>()
</script>
<template>
  <div class="arena-board arena-table" data-layout="opposite-table" data-view="first-person" :data-focus-zone="focusZone || ''">
    <div class="arena-table-perspective"><div class="arena-table-plane"><slot /></div></div>
    <div class="arena-hand-dock"><slot name="hand" /><slot name="actions" /></div>
  </div>
</template>
<style src="~/assets/css/arena-table.css"></style>
<style src="~/assets/css/arena-interactions.css"></style>
<style src="~/assets/css/arena-perspective.css"></style>
