<script setup lang="ts">
const route = useRoute()
const purpose = ['early_access', 'support', 'privacy'].includes(String(route.query.purpose)) ? String(route.query.purpose) : ''
await navigateTo({ path: '/contact', query: purpose ? { purpose } : {} }, { redirectCode: 301, replace: true })
</script>
<template><p>Opening CardShelf contact options…</p></template>
