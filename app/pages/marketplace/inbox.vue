<script setup lang="ts">
import { aud } from '../../../shared/marketplace.mjs'
const api = useApi(), route = useRoute(), notice = useNotice()
const items = ref<any[]>([]), data = ref<any>(null), page = ref(1), hasMore = ref(false), loading = ref(false), busy = ref(false)
const message = ref(''), pending = ref<any>(null), failure = ref('')
const selected = computed(() => typeof route.query.thread === 'string' ? route.query.thread : '')
let sequence = 0
async function loadInbox() {
  try { const next = await api('/api/marketplace/conversations', { query: { page: page.value } }); items.value = next.items; hasMore.value = next.has_more }
  catch (e) { notice.show(errorMessage(e), 'error') }
}
async function loadThread(older = false) {
  if (!selected.value) { data.value = null; return }
  const current = ++sequence; loading.value = true; failure.value = ''
  try {
    const next = await api('/api/marketplace/conversations/' + selected.value, { query: older ? { before: data.value.messages[0]?.id } : {} })
    if (current !== sequence) return
    if (older) next.messages = [...next.messages, ...data.value.messages]
    data.value = next
  } catch (e) { if (current === sequence) failure.value = errorMessage(e) }
  finally { if (current === sequence) loading.value = false }
}
async function refresh() { await Promise.all([loadInbox(), loadThread()]) }
onMounted(refresh); watch(selected, () => { message.value = ''; pending.value = null; data.value = null; loadThread() }); watch(page, loadInbox)
onBeforeUnmount(() => { sequence++ })
async function send() {
  if (busy.value) return
  const id = selected.value
  pending.value ||= { request_id: crypto.randomUUID(), message: message.value }
  busy.value = true
  try { await api('/api/marketplace/conversations/' + id + '/messages', { method: 'POST', body: pending.value }); if (id === selected.value) { pending.value = null; message.value = ''; await refresh() } }
  catch (e: any) { notice.show(errorMessage(e), 'error'); const status = e?.statusCode || e?.response?.status; if (status >= 400 && status < 500) { pending.value = null; await loadThread() } }
  finally { busy.value = false }
}
async function close() {
  if (!window.confirm('Close this conversation? Neither participant can send further messages or reopen it in this release. The existing messages remain available.')) return
  busy.value = true
  try { await api('/api/marketplace/conversations/' + selected.value + '/close', { method: 'POST', body: { revision: data.value.thread.revision } }); await refresh() }
  catch (e) { notice.show(errorMessage(e), 'error'); await loadThread() } finally { busy.value = false }
}
function time(value: string) { return new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) }
</script>
<template>
  <MarketplaceShell title="A conversation for every find" subtitle="Your private buying and selling enquiries. No automatic email or push notifications.">
    <div class="market-controls"><p class="market-help">Messages update when you open or refresh the conversation.</p><button class="button secondary" :disabled="loading || busy" @click="refresh"><AppIcon name="refresh" :size="17" />Refresh</button></div>
    <div class="market-inbox" :class="{ 'has-thread': selected }">
      <aside class="market-thread-sidebar"><div class="market-thread-list"><NuxtLink v-for="t in items" :key="t.id" class="market-thread-link" :class="{ selected: selected === t.id }" :to="{ path: '/marketplace/inbox', query: { thread: t.id } }"><strong>{{ t.card_name }}</strong><small>{{ t.my_role === 'seller' ? 'Selling · ' + t.buyer_alias : 'Buying · ' + t.seller_alias }}</small><small>{{ t.closed ? 'Closed' : 'Open enquiry' }} · {{ time(t.updated_at) }}</small></NuxtLink><p v-if="!items.length" class="market-help">No enquiries yet. Open a listing to start a conversation.</p></div><div v-if="hasMore || page > 1" class="market-actions"><button class="button secondary" :disabled="page === 1" @click="page--">Previous</button><button class="button secondary" :disabled="!hasMore" @click="page++">Next</button></div></aside>
      <section class="market-chat"><NuxtLink to="/marketplace/inbox" class="market-back market-mobile-back">← All enquiries</NuxtLink><p v-if="loading" role="status" class="market-help">Loading messages…</p><div v-if="failure" class="market-error" role="alert">{{ failure }}</div>
        <template v-if="data"><h2>{{ data.thread.card_name }}</h2><NuxtLink :to="'/marketplace/' + data.thread.listing_id" class="market-back">View current listing →</NuxtLink><p class="market-help">At first enquiry: {{ aud(data.thread.quoted_price_minor) }} asking price + {{ aud(data.thread.quoted_postage_minor) }} postage. This is a reference, not an agreed order or proof of payment.</p><button v-if="data.has_older" class="text-button" :disabled="loading" @click="loadThread(true)">Load older messages</button>
          <div class="market-messages" aria-live="polite"><article v-for="m in data.messages" :key="m.id" class="market-message" :class="{ mine: m.mine }"><small><strong>{{ m.mine ? 'You' : data.thread.my_role === 'seller' ? data.thread.buyer_alias : data.thread.seller_alias }}</strong></small><p>{{ m.body }}</p><small>{{ time(m.created_at) }}</small></article></div>
          <p v-if="data.thread.closed || data.thread.hidden" class="market-notice">{{ data.thread.closed ? 'This conversation is closed.' : 'Messaging is paused while the listing is hidden by a moderator.' }}</p>
          <form v-else @submit.prevent="send"><label>Your message<textarea v-model="message" :disabled="busy || !!pending" maxlength="2000" required placeholder="Keep the discussion about this card. Never share passwords or payment-card details." /></label><div class="market-actions"><button class="button primary" :disabled="busy">{{ busy ? 'Sending…' : pending ? 'Retry message' : 'Send message' }}</button><button class="text-button market-danger" type="button" :disabled="busy" @click="close">Close conversation</button><NuxtLink :to="'/marketplace/' + data.thread.listing_id + '#report'" class="text-button">Report listing</NuxtLink></div></form>
        </template><p v-else-if="!loading && !failure" class="market-help">Select an enquiry to read and reply.</p>
      </section>
    </div>
  </MarketplaceShell>
</template>
