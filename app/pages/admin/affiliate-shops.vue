<script setup lang="ts">
import { GAMES } from '../../../shared/games.mjs'
import { AMAZON_STARTERS, amazonShop, affiliateLinks } from '../../../shared/affiliate-shops.mjs'
const api = useApi(), notice = useNotice()
const saved = ref<any>(null), shops = ref<any[]>([]), enabled = ref(false), password = ref(''), busy = ref(false), error = ref('')
const previewPlacement = ref('marketplace'), previewQuery = ref('Charizard 4 Base Set English')
const placements = [{ code: 'marketplace', name: 'Marketplace' }, { code: 'cards', name: 'Collection card details' }, { code: 'catalogue', name: 'Public catalogue card details' }]
const previewShops = computed(() => shops.value.map(shop => ({ ...shop, enabled: true })))
const published = ref<any[] | null>(null), checking = ref(false), publicationError = ref('')
const publishedMarketplace = computed(() => affiliateLinks(published.value || [], { placement: 'marketplace' }))
async function checkPublished() {
  checking.value = true; publicationError.value = ''
  try { const result = await api('/api/public/affiliate-shops'); if (!Array.isArray(result.shops)) throw new Error('The saved links could not be read.'); published.value = result.shops }
  catch (e) { published.value = null; publicationError.value = errorMessage(e) }
  finally { checking.value = false }
}
function accept(value: any) { saved.value = value; enabled.value = value.enabled; shops.value = structuredClone(value.shops).map((shop: any) => ({ ...shop, retailer: shop.retailer || (amazonShop(shop) ? 'amazon' : 'other') })) }
async function load() { error.value = ''; try { accept(await api('/api/admin/affiliate-shops')) } catch (e) { error.value = errorMessage(e) } }
onMounted(async () => { await load(); await checkPublished() })
function add(retailer = 'other', name = '', description = '') { if (shops.value.length < 12) shops.value.push({ id: crypto.randomUUID(), retailer, name, description, url: '', search_url: '', referral_code: '', enabled: false, placements: ['marketplace','cards','catalogue'], games: [], expires_on: '' }) }
function addAmazon() { if (shops.value.length <= 9) for (const entry of AMAZON_STARTERS) add('amazon', entry.name, entry.description) }
function move(index: number, delta: number) { const next = index + delta; if (next < 0 || next >= shops.value.length) return; const [shop] = shops.value.splice(index, 1); shops.value.splice(next, 0, shop) }
async function save() {
  if (busy.value || !saved.value) return
  busy.value = true; error.value = ''
  try { accept(await api('/api/admin/affiliate-shops', { method: 'POST', body: { enabled: enabled.value, shops: shops.value, revision: saved.value.revision, password: password.value } })); notice.show('Affiliate shops saved.'); await checkPublished() }
  catch (e) { error.value = errorMessage(e) }
  finally { busy.value = false; password.value = '' }
}
useSeoMeta({ title: 'Affiliate shops · CardShelf' })
</script>
<template>
  <header class="page-heading"><div><span class="eyebrow">EXTERNAL SHOPPING</span><h1>Affiliate shops</h1><p>Help collectors find binders, sleeves, cards and packs through your affiliate links.</p></div></header>
  <p v-if="error" class="alert error" role="alert">{{ error }} <button type="button" class="text-button" :disabled="busy" @click="load">Reload saved settings</button></p>
  <form v-if="saved" class="affiliate-settings form-stack" @submit.prevent="save">
    <section class="panel affiliate-section form-stack" data-testid="affiliate-publication">
      <h2>Saved marketplace visibility</h2>
      <p v-if="checking" role="status">Checking saved links…</p>
      <p v-else-if="publicationError" class="alert error" role="alert">Unable to check saved links: {{ publicationError }}</p>
      <template v-else-if="published !== null">
        <p v-if="publishedMarketplace.length" class="alert info">{{ publishedMarketplace.length }} saved {{ publishedMarketplace.length === 1 ? 'link is' : 'links are' }} available on the marketplace’s Browse cards page: {{ publishedMarketplace.map((shop: any) => shop.name).join(', ') }}.</p>
        <p v-else class="alert warning">No saved affiliate links are currently visible in the marketplace. Turn on the main switch and each shop, select Marketplace, check the end date, then save.</p>
      </template>
      <p class="data-note">This checks the same saved links the marketplace loads. The draft preview below also shows paused shops. My listings and private enquiries do not show affiliate links.</p>
      <div class="button-row"><NuxtLink to="/marketplace" class="button secondary">View marketplace</NuxtLink><button type="button" class="text-button" :disabled="checking || busy" @click="checkPublished">Check saved links</button></div>
    </section>
    <section class="panel affiliate-section form-stack">
      <label class="checkbox-label"><input v-model="enabled" type="checkbox" :disabled="busy">Show affiliate shopping links</label>
      <p class="data-note">Use the complete tracking URL supplied by each programme, such as CardTrader, TCGplayer or another shop. Commission eligibility is managed by that programme. These are external shopping options: CardShelf does not take payment, place orders or import stock.</p>
      <p class="data-note">For CardTrader, an issued referral code can be displayed alongside your link. A normal CardTrader link or API key does not establish commission tracking. Confirm the approved URL, code and reward terms with CardTrader.</p>
      <p class="data-note">Links are labelled as affiliate links on every selected page. They can appear for visitors and all membership tiers. No shop scripts or automatic visits are loaded. URLs and referral codes are public: never paste an API key or secret.</p>
    </section>
    <section class="panel affiliate-section form-stack">
      <h2>Start with Amazon</h2><p class="data-note">Create entries for binders, sleeves and card packs, then paste your complete Amazon Associates links from SiteStripe or Mobile GetLink. Use links for the Amazon country programme you joined. Keep Amazon’s tracking details exactly as supplied.</p>
      <p class="data-note">Choose specific products or relevant category links. The Amazon disclosure appears automatically. Add CardShelf’s public website URL to your Associates account. Amazon manages checkout, shipping and commission reports.</p>
      <p class="data-note">CardShelf includes card price history. Amazon’s participation rules restrict price-tracking sites unless agreed by Amazon, so confirm CardShelf’s eligibility with Associates before enabling Amazon links.</p>
      <button type="button" class="button secondary" :disabled="busy || shops.length > 9" @click="addAmazon">Add Amazon starter links</button>
      <p class="data-note">The three entries start paused. Fill each link or remove an unused entry before saving.</p>
    </section>
    <fieldset v-for="(shop, index) in shops" :key="shop.id" class="panel affiliate-section shop-editor form-stack" :disabled="busy">
      <legend>{{ shop.name || 'New shop' }}</legend>
      <div class="affiliate-actions"><label class="checkbox-label"><input v-model="shop.enabled" type="checkbox">Enable this shop</label><button type="button" class="text-button" :disabled="index === 0" :aria-label="'Move shop ' + (index + 1) + ' up'" @click="move(index, -1)">Move up</button><button type="button" class="text-button" :disabled="index === shops.length - 1" :aria-label="'Move shop ' + (index + 1) + ' down'" @click="move(index, 1)">Move down</button><button type="button" class="text-button" :aria-label="'Remove shop ' + (index + 1)" @click="shops.splice(index, 1)">Remove</button></div>
      <label>Shop name<input v-model="shop.name" required maxlength="60" placeholder="e.g. CardTrader"></label>
      <label>Retailer<select v-model="shop.retailer"><option value="other">Other shop</option><option value="amazon">Amazon Associates</option></select></label>
      <label>Description<input v-model="shop.description" maxlength="180" placeholder="e.g. English singles and sealed packs"></label>
      <label>Affiliate shop URL<input v-model="shop.url" required type="url" maxlength="2048" placeholder="https://…" autocomplete="off"></label>
      <label v-if="!amazonShop(shop) || shop.search_url">Optional affiliate search URL<input v-model="shop.search_url" maxlength="2048" placeholder="https://shop.example.com/search?q={query}&amp;ref=your-code" autocomplete="off"></label>
      <p v-if="!amazonShop(shop)" class="data-note">Use {query} where the shop expects the search text. CardShelf encodes the card’s name, set, number and language, or the marketplace search. Leave blank to always open the shop URL. Use a search link only if your programme supports it; check that its tracking parameters are retained.</p>
      <p v-else class="data-note">Amazon links open exactly as supplied, including short links. Keep search templates and coupon codes blank; your tracking ID is part of the Amazon link. Prices and availability are checked on Amazon.</p>
      <div class="affiliate-fields"><label v-if="!amazonShop(shop) || shop.referral_code">Optional referral or coupon code<input v-model="shop.referral_code" maxlength="80" autocomplete="off"></label><label>Optional end date<input v-model="shop.expires_on" type="date"></label></div>
      <p class="data-note">The whole shop link is hidden after its end date (UTC). Leave blank for no scheduled expiry.</p>
      <fieldset class="affiliate-choices"><legend>Show on</legend><label v-for="placement in placements" :key="placement.code" class="checkbox-label"><input v-model="shop.placements" type="checkbox" :value="placement.code">{{ placement.name }}</label></fieldset>
      <fieldset class="affiliate-choices"><legend>Games</legend><label v-for="game in GAMES" :key="game.code" class="checkbox-label"><input v-model="shop.games" type="checkbox" :value="game.code">{{ game.name }}</label><p class="data-note">Leave all unchecked for every game. General marketplace browsing shows all enabled shops.</p></fieldset>
    </fieldset>
    <button type="button" class="button secondary" :disabled="busy || shops.length >= 12" @click="add()">Add shop</button>
    <section class="panel affiliate-section form-stack">
      <h2>Preview your links</h2><p class="data-note">Shows valid, unexpired draft links for the selected placement, including paused shops. Nothing is published until you save and enable it. Opening a preview link visits the external shop.</p>
      <div class="affiliate-fields"><label>Preview placement<select v-model="previewPlacement"><option v-for="placement in placements" :key="placement.code" :value="placement.code">{{ placement.name }}</option></select></label><label>Preview search<input v-model="previewQuery" maxlength="300"></label></div>
      <AffiliateLinks :shops="previewShops" :placement="previewPlacement" :search="previewQuery" />
      <p v-if="!shops.length" class="muted">Add your first shop to see its preview.</p>
    </section>
    <section class="panel affiliate-section form-stack"><label>Current administrator password<input v-model="password" required type="password" autocomplete="current-password" maxlength="128" :disabled="busy"></label><button class="button primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save affiliate shops' }}</button></section>
  </form><p v-else-if="!error" class="loading-panel">Loading affiliate settings…</p>
</template>
<style scoped>
.affiliate-settings{max-width:960px}.affiliate-section{padding:24px;min-width:0;margin:0}.affiliate-section legend{padding:0 8px;font-weight:700;overflow-wrap:anywhere}.affiliate-actions{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.affiliate-actions .checkbox-label{margin-right:auto}.affiliate-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.affiliate-choices{border:1px solid var(--line,#ddd);border-radius:10px;padding:14px;display:flex;flex-wrap:wrap;gap:14px;min-width:0}.affiliate-choices p{flex-basis:100%;margin:0}.affiliate-section h2{font-size:19px;margin:0}.affiliate-settings input:not([type=checkbox]),.affiliate-settings select{width:100%;min-width:0}@media(max-width:650px){.affiliate-fields{grid-template-columns:1fr}.affiliate-section{padding:16px}}
</style>
