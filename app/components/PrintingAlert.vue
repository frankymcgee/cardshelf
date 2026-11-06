<script setup lang="ts">
const props = defineProps<{ printingId: string; wishlisted: boolean }>()
const api = useApi(), busy = ref(false), loaded = ref(false), error = ref(''), revision = ref(0)
const form = reactive({ target: '', watch_market: true, watch_listings: true, conditions: ['NM'], enabled: true })
async function load() {
  busy.value = true
  try {
    const result = await api('/api/wishlist-alerts', { query: { printing_id: props.printingId } }), rule = result.rules[0]
    revision.value = rule?.revision || 0
    if (rule) Object.assign(form, { target: (rule.target_aud_minor / 100).toFixed(2), watch_market: rule.watch_market, watch_listings: rule.watch_listings, conditions: [...rule.conditions], enabled: rule.enabled })
    loaded.value = true
  } catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
function toggle(event: Event) { if ((event.target as HTMLDetailsElement).open && !loaded.value) load() }
async function save() {
  if (busy.value) return
  error.value = ''
  if (!/^\d+(\.\d{1,2})?$/.test(form.target)) { error.value = 'Enter an AUD target with up to two decimal places.'; return }
  busy.value = true
  try {
    const rule = await api('/api/wishlist-alerts', { method: 'POST', body: { printing_id: props.printingId, revision: revision.value, target_aud_minor: Math.round(Number(form.target) * 100), watch_market: form.watch_market, watch_listings: form.watch_listings, conditions: form.conditions, enabled: form.enabled } })
    revision.value = rule.revision
  } catch (e) { error.value = errorMessage(e) + ' Reload the saved alert before trying again.' }
  finally { busy.value = false }
}
</script>
<template><details class="printing-alert" @toggle="toggle"><summary>Wishlist price & listing alerts</summary><p class="data-note">Matches appear in your private <NuxtLink to="/wishlist-alerts">Wishlist alerts</NuxtLink> inbox. Exact printing only. Member prices include advertised postage; pickup travel is excluded.</p><p v-if="!wishlisted" class="alert info">Add this printing to your wishlist to enable alerts. Removing it from your wishlist pauses checks.</p><p v-if="error" class="alert error" role="alert">{{ error }} <button class="text-button" :disabled="busy" @click="load">Reload saved alert</button></p><form v-if="loaded" class="form-stack" @submit.prevent="save"><label>Target total (AUD)<input v-model="form.target" required inputmode="decimal" placeholder="e.g. 15.00" :disabled="busy" /></label><label class="checkbox-label"><input v-model="form.watch_market" type="checkbox" :disabled="busy" />Market price reaches target</label><p class="data-note">Requires a fresh exact market quote and AUD rate. Guide estimates do not trigger alerts. Market prices are not condition adjusted; currently available for supported English printings.</p><label class="checkbox-label"><input v-model="form.watch_listings" type="checkbox" :disabled="busy" />Member listing at or below target</label><fieldset v-if="form.watch_listings" :disabled="busy"><legend>Listing conditions</legend><label v-for="c in ['NM','LP','MP','HP','DMG','UNKNOWN']" :key="c" class="checkbox-label"><input v-model="form.conditions" :value="c" type="checkbox" />{{ c }}</label></fieldset><label class="checkbox-label"><input v-model="form.enabled" type="checkbox" :disabled="busy" />Alert enabled</label><button class="button secondary" :disabled="busy || (form.enabled && !wishlisted)">{{ busy ? 'Saving…' : revision ? 'Save alert' : 'Create alert' }}</button><p v-if="revision" class="small muted">Saved alert · revision {{ revision }}</p></form></details></template>
<style scoped>.printing-alert{margin:18px 0;border-block:1px solid var(--line);padding:12px 0}.printing-alert summary{min-height:36px;cursor:pointer;font-weight:650}.printing-alert fieldset{display:flex;flex-wrap:wrap;gap:10px;border:1px solid var(--line);border-radius:8px;min-width:0}.printing-alert legend{font-size:12px}</style>
