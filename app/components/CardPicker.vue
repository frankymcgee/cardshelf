<script setup lang="ts">
const props = defineProps<{ open: boolean }>(), emit = defineEmits(['close', 'select'])
const api = useApi(), notice = useNotice(), query = ref(''), language = ref(''), items = ref<any[]>([]), selected = ref<any>(null), loading = ref(false), total = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined, sequence = 0, selectionSequence = 0
async function search() {
  const request = ++sequence; loading.value = true
  try { const response = await api('/api/catalogue', { query: { q: query.value, language: language.value, limit: 24 } }); if (request === sequence) { items.value = response.items; total.value = response.total } }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { if (request === sequence) loading.value = false }
}
watch([query, language], () => { clearTimeout(timer); timer = setTimeout(search, 250) })
watch(() => props.open, value => { if (value) { selected.value = null; search() } else { sequence++; selectionSequence++; clearTimeout(timer) } })
onBeforeUnmount(() => { sequence++; selectionSequence++; clearTimeout(timer) })
async function choose(card: any) {
  const request = ++selectionSequence
  try { const next = await api('/api/cards/' + encodeURIComponent(card.id)); if (request === selectionSequence && props.open) selected.value = next }
  catch (e) { if (request === selectionSequence && props.open) notice.show(errorMessage(e), 'error') }
}
</script>
<template><AppModal :open="open" title="Choose a card for this pocket" wide @close="emit('close')"><div v-if="!selected"><div class="picker-search"><label class="search-field"><AppIcon name="search" /><input v-model="query" placeholder="Search by name or card number" aria-label="Search catalogue" /></label><select v-model="language" aria-label="Card language"><option value="">All languages</option><option value="en">English</option><option value="ja">Japanese</option></select></div><p class="muted small">Choose a card, then its exact printing. Missing cards can be placed in your plan too.</p><p v-if="loading" class="loading-panel">Searching…</p><div v-else class="picker-grid"><button v-for="card in items" :key="card.id" class="picker-card" @click="choose(card)"><img v-if="card.image_url" :src="card.image_url.replace('/high.webp', '/low.webp')" alt="" loading="lazy" /><AppIcon v-else name="cards" :size="36" /><strong>{{ card.name }}</strong><small>{{ card.set_name }} · #{{ card.local_id }}</small></button></div><p v-if="!loading && !items.length" class="empty-inline">No matching cards. Import a set in Data & settings first.</p><p v-if="total > 24" class="muted small">Showing the first 24 of {{ total }} cards. Refine your search to find a specific card.</p></div><div v-else><button class="text-button" @click="selected = null"><AppIcon name="left" :size="16" />Back to cards</button><h3>{{ selected.name }}</h3><p class="muted">{{ selected.set_name }} · #{{ selected.local_id }} · {{ selected.language.toUpperCase() }}</p><div class="form-stack"><button v-for="p in selected.printings" :key="p.id" class="printing-choice" @click="emit('select', p.id)"><span><strong>{{ p.label }}</strong><small>{{ p.verified ? 'Verified printing' : 'Printing details not independently verified' }}</small></span><AppIcon name="arrow" /></button></div></div></AppModal></template>
