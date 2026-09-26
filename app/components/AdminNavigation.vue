<script setup lang="ts">
import { ADMIN_GROUPS } from '../../shared/navigation.mjs'
const route = useRoute()
function change(event: Event) { const path = (event.target as HTMLSelectElement).value; if (path) navigateTo(path) }
</script>
<template><nav class="admin-navigation" aria-label="Administration navigation"><NuxtLink to="/admin" class="text-button"><AppIcon name="grid" :size="18"/>Administration</NuxtLink><label><span class="sr-only">Go to admin section</span><select :value="route.path" @change="change"><option value="/admin">Administration home</option><optgroup v-for="group in ADMIN_GROUPS" :key="group.id" :label="group.title"><option v-for="item in group.links" :key="item.to" :value="item.to">{{ item.label }}</option></optgroup></select></label></nav></template>
<style scoped>
.admin-navigation{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:18px;margin-bottom:24px;border-bottom:1px solid var(--line)}.admin-navigation label{min-width:0}.admin-navigation select{max-width:100%;min-height:44px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:600px){.admin-navigation{align-items:stretch;flex-direction:column;gap:10px}.admin-navigation select{width:100%}}
</style>
