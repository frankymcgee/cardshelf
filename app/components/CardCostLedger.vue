<script setup lang="ts">
const props = defineProps<{ printingId: string; label: string }>(), emit = defineEmits(['saved'])
const api = useApi(), ledger = ref<any>(null), opened = ref(false), busy = ref(false), error = ref('')
const today = () => new Date().toISOString().slice(0, 10)
const form = reactive({ condition: 'NM', quantity: 1, acquired_on: today(), goods: '', postage: '0', currency: 'AUD', aud_rate: '', add_to_collection: false })
const saleLot = ref<any>(null), sale = reactive({ quantity: 1, sold_on: today(), gross: '', fees: '0', postage: '0', currency: 'AUD', aud_rate: '' })
const releaseId = ref('')
let pending: { url: string; body: any } | null = null
const retry = ref(false), lotPage = ref(1)
const money = (minor: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(minor) / 100)
const date = (value: string) => new Date(value).toISOString().slice(0, 10)
const minor = (value: string) => { if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter money with up to two decimal places.'); return Math.round(Number(value) * 100) }
const revision = (condition: string) => ledger.value?.entries.find((e: any) => e.condition === condition)?.revision || 0
async function load() {
  try { ledger.value = await api('/api/portfolio/costs', { query: { printing_id: props.printingId, page: lotPage.value } }) }
  catch (e) { error.value = errorMessage(e) }
}
async function toggle(event: Event) { opened.value = (event.target as HTMLDetailsElement).open; if (opened.value && !ledger.value) await load() }
async function send(url?: string, body?: any) {
  if (busy.value) return
  if (!pending && url) pending = { url, body: { ...body, request_id: crypto.randomUUID() } }
  if (!pending) return
  busy.value = true; error.value = ''
  try {
    await api(pending.url, { method: 'POST', body: pending.body })
    pending = null; retry.value = false; saleLot.value = null; releaseId.value = ''
    lotPage.value = 1; await load(); emit('saved')
  } catch (e: any) {
    error.value = errorMessage(e)
    const status = e?.statusCode || e?.status || e?.response?.status
    if (status >= 400 && status < 500) { pending = null; retry.value = false; await load() }
    else { retry.value = true; error.value += ' Use Retry to check the same transaction safely.' }
  } finally { busy.value = false }
}
function purchase() {
  try { send('/api/portfolio/costs', { printing_id: props.printingId, ...form, goods_minor: minor(form.goods), postage_minor: minor(form.postage), entry_revision: revision(form.condition) }) }
  catch (e) { error.value = errorMessage(e) }
}
function sell() {
  const lot = saleLot.value
  try { send('/api/portfolio/costs/' + lot.id, { action: 'sale', revision: lot.revision, entry_revision: revision(lot.condition), ...sale, gross_minor: minor(sale.gross), fees_minor: minor(sale.fees), postage_minor: minor(sale.postage) }) }
  catch (e) { error.value = errorMessage(e) }
}
function release(lot: any) { send('/api/portfolio/costs/' + lot.id, { action: 'release', revision: lot.revision }) }
</script>
<template>
  <details class="cost-ledger" @toggle="toggle"><summary>Purchase costs & sales · {{ label }}</summary>
    <p class="data-note">Private cost records for this printing and condition. Unrecorded costs remain unknown. Totals include postage; sales deduct fees and postage.</p>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p><button v-if="retry" class="button primary" :disabled="busy" @click="send()">Retry transaction</button>
    <template v-if="ledger"><fieldset :disabled="busy || retry" class="cost-fields"><legend>Record a purchase</legend>
      <form class="form-stack" @submit.prevent="purchase"><div class="form-columns"><label>Condition<select v-model="form.condition"><option v-for="c in ['NM','LP','MP','HP','DMG','UNKNOWN']" :key="c">{{ c }}</option></select></label><label>Copies<input v-model.number="form.quantity" required type="number" min="1" max="9999" /></label><label>Purchase date<input v-model="form.acquired_on" required type="date" :max="today()" /></label></div>
        <div class="form-columns"><label>Currency<select v-model="form.currency"><option>AUD</option><option>USD</option><option>EUR</option></select></label><label>Cards total<input v-model="form.goods" required inputmode="decimal" placeholder="0.00" /></label><label>Postage total<input v-model="form.postage" required inputmode="decimal" /></label></div>
        <label v-if="form.currency !== 'AUD'">AUD per {{ form.currency }} on purchase date<input v-model="form.aud_rate" required type="number" min="0.00000001" max="1000" step="0.00000001" /></label>
        <label class="checkbox-label"><input v-model="form.add_to_collection" type="checkbox" />Also add these copies to my collection</label><p class="data-note">Leave unchecked to attach costs to copies you already recorded. A total of zero explicitly records a gift/free purchase.</p><button class="button secondary">Save purchase</button>
      </form>
    </fieldset>
    <h4>Purchase lots</h4><p v-if="!ledger.lots.length" class="small muted">No purchase costs recorded.</p>
    <article v-for="lot in ledger.lots" :key="lot.id" class="cost-lot"><strong>{{ date(lot.acquired_on) }} · {{ lot.condition }} · {{ lot.remaining_quantity }} / {{ lot.quantity }} copies tracked</strong><p>{{ money(lot.cost_aud_minor) }} original total · {{ lot.currency }}<template v-if="lot.currency !== 'AUD'"> at {{ lot.aud_rate }} AUD</template></p>
      <div v-if="lot.remaining_quantity" class="button-row"><button class="text-button" :disabled="busy || retry" @click="saleLot = lot; sale.quantity = 1; releaseId = ''">Record sale</button><button class="text-button" :disabled="busy || retry" @click="releaseId = lot.id; saleLot = null">Release cost tracking</button></div>
      <div v-if="releaseId === lot.id" class="alert info"><p>Remove cost tracking from the remaining {{ lot.remaining_quantity }} copies? Ownership and past sales stay unchanged. You can then record corrected costs.</p><button class="button secondary" :disabled="busy || retry" @click="release(lot)">Confirm release</button><button class="text-button" @click="releaseId = ''">Cancel</button></div>
      <form v-if="saleLot?.id === lot.id" class="form-stack" @submit.prevent="sell"><fieldset class="cost-fields" :disabled="busy || retry"><legend>Record sale and remove sold copies</legend><div class="form-columns"><label>Copies<input v-model.number="sale.quantity" type="number" required min="1" :max="lot.remaining_quantity" /></label><label>Sale date<input v-model="sale.sold_on" required type="date" :min="date(lot.acquired_on)" :max="today()" /></label><label>Currency<select v-model="sale.currency"><option>AUD</option><option>USD</option><option>EUR</option></select></label></div><div class="form-columns"><label>Sale total<input v-model="sale.gross" required inputmode="decimal" /></label><label>Fees total<input v-model="sale.fees" required inputmode="decimal" /></label><label>Postage paid<input v-model="sale.postage" required inputmode="decimal" /></label></div><label v-if="sale.currency !== 'AUD'">AUD per {{ sale.currency }} on sale date<input v-model="sale.aud_rate" required type="number" min="0.00000001" max="1000" step="0.00000001" /></label><p class="data-note">Saving reduces collection quantity. Cost is allocated proportionally from this lot.</p><button class="button primary">Save sale</button><button type="button" class="text-button" @click="saleLot = null">Cancel</button></fieldset></form>
    </article><div v-if="ledger.total > 50" class="button-row"><button class="button secondary" :disabled="busy || retry || lotPage <= 1" @click="lotPage--; load()">Previous lots</button><span class="small">Page {{ lotPage }} of {{ Math.ceil(ledger.total / 50) }}</span><button class="button secondary" :disabled="busy || retry || lotPage * 50 >= ledger.total" @click="lotPage++; load()">Next lots</button></div><details v-if="ledger.sales.length"><summary>Recent sales (up to 100)</summary><p v-for="s in ledger.sales" :key="s.id" class="small">{{ date(s.sold_on) }} · {{ s.quantity }} copies · net {{ money(s.net_aud_minor) }} · profit/loss {{ money(Number(s.net_aud_minor) - Number(s.cost_aud_minor)) }}</p></details>
    </template>
  </details>
</template>
<style scoped>
.cost-ledger{margin:18px 0;border-block:1px solid var(--line);padding:12px 0}.cost-ledger summary{cursor:pointer;min-height:36px;font-weight:650}.cost-fields{min-width:0;border:1px solid var(--line);padding:12px;border-radius:10px;margin:12px 0}.cost-fields legend{font-size:13px}.cost-lot{border-top:1px solid var(--line);padding:14px 0;font-size:12px;overflow-wrap:anywhere}.cost-lot p{margin:7px 0}.cost-fields .form-columns{flex-wrap:wrap}.cost-fields input,.cost-fields select{min-width:0;width:100%}@media(max-width:600px){.cost-fields .form-columns{display:grid;grid-template-columns:1fr 1fr}.cost-fields{padding:8px}.cost-fields label{min-width:0}}
</style>
