<script setup lang="ts">
import { AFFILIATE_DISCLOSURE, AMAZON_DISCLOSURE, affiliateLinks, amazonShop } from '../../shared/affiliate-shops.mjs'
const props = defineProps<{ placement: string; card?: any; search?: string; game?: string; shops?: any[] }>()
const api = useApi(), fetched = ref<any[]>([])
let alive = true
const links = computed(() => affiliateLinks(props.shops ?? fetched.value, { placement: props.placement, card: props.card, search: props.search, game: props.game }))
const hasAmazon = computed(() => links.value.some(amazonShop))
const linkLabel = (shop: any) => amazonShop(shop) ? shop.name + ' on Amazon' : (shop.isSearch ? 'Search ' : 'Visit ') + shop.name
onMounted(async () => {
  if (props.shops !== undefined) return
  try { const result = await api('/api/public/affiliate-shops'); if (alive) fetched.value = result.shops }
  catch { /* Optional shopping links never prevent browsing or collection editing. */ }
})
onBeforeUnmount(() => { alive = false })
</script>
<template>
  <section v-if="links.length" class="affiliate-shops" aria-label="External shops" data-testid="affiliate-shops">
    <div class="affiliate-heading"><h3>Explore external shops</h3><span class="badge">Affiliate links</span></div>
    <p class="affiliate-disclosure">{{ AFFILIATE_DISCLOSURE }}</p>
    <p v-if="hasAmazon" class="affiliate-disclosure amazon-disclosure" data-testid="amazon-disclosure">{{ AMAZON_DISCLOSURE }}</p>
    <div class="affiliate-list"><article v-for="shop in links" :key="shop.id" class="affiliate-shop">
      <div><strong>{{ shop.name }}</strong><p v-if="shop.description">{{ shop.description }}</p><p v-if="shop.referral_code && !amazonShop(shop)" class="affiliate-code">Referral code: <code>{{ shop.referral_code }}</code><small>Enter at the shop’s checkout. Eligibility and expiry follow the shop’s terms.</small></p></div>
      <a class="button secondary small-button" :href="shop.href" target="_blank" rel="sponsored nofollow noopener" referrerpolicy="strict-origin-when-cross-origin" :aria-label="linkLabel(shop) + ' (opens in a new tab)'">{{ linkLabel(shop) }} <span aria-hidden="true">↗</span></a>
    </article></div>
    <p class="affiliate-availability">Check the product, card size or printing, language, price and delivery options at the shop. These links do not confirm stock availability.</p>
  </section>
</template>
<style scoped>
.affiliate-shops{margin:24px 0;padding:20px;border:1px solid var(--line,#dfe3ec);border-radius:16px;background:var(--surface,#fff);color:var(--text,#252338);min-width:0}.affiliate-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.affiliate-heading h3{font-size:17px;margin:0}.affiliate-disclosure,.affiliate-availability{font-size:12px;line-height:1.65;color:var(--muted,#656378);margin:10px 0 0}.affiliate-list{display:grid;gap:12px;margin-top:16px}.affiliate-shop{display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--line,#dfe3ec);padding-top:14px;min-width:0}.affiliate-shop>div{min-width:0}.affiliate-shop p{font-size:12px;line-height:1.6;margin:6px 0;overflow-wrap:anywhere}.affiliate-shop strong,.affiliate-shop code{overflow-wrap:anywhere}.affiliate-shop small{display:block;color:var(--muted,#656378);margin-top:4px}.affiliate-shop a{flex-shrink:0;white-space:normal;overflow-wrap:anywhere;text-align:center}.affiliate-code code{font-weight:700}@media(max-width:650px){.affiliate-shop{align-items:stretch;flex-direction:column;gap:8px}.affiliate-shop a{justify-content:center}.affiliate-shops{padding:16px}}
</style>
<style scoped>
.amazon-disclosure{font-weight:650;color:var(--ink,#252338)}
.affiliate-shop a{max-width:50%}
@media(max-width:650px){.affiliate-shop a{max-width:100%}}
</style>
