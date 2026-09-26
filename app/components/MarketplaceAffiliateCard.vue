<script setup lang="ts">
import { affiliateImageUrl, amazonShop, affiliateLinkLabel, affiliateLinkDescription } from '../../shared/affiliate-shops.mjs'
const props = defineProps<{ shop: any; preview?: boolean; disclosureId?: string }>()
const imageUrl = computed(() => affiliateImageUrl(props.shop, props.preview))
const failedImage = ref('')
</script>
<template>
  <article class="market-card marketplace-affiliate" :data-testid="shop.kind === 'product' ? 'affiliate-product' : 'affiliate-shop'" data-market-affiliate>
    <div class="market-card-photo affiliate-photo">
      <img v-if="imageUrl && failedImage !== imageUrl" :src="imageUrl" :alt="shop.name" loading="lazy" width="300" height="420" @error="failedImage = imageUrl" />
      <div v-else class="affiliate-photo-placeholder"><AppIcon name="cards" :size="38" /><span>{{ shop.kind === 'product' ? 'Product image unavailable' : 'External shop' }}</span></div>
      <span class="market-pill affiliate-label">Affiliate link</span>
    </div>
    <div class="market-card-copy affiliate-copy">
      <h2>{{ shop.name }}</h2>
      <p v-if="shop.description" class="affiliate-description">{{ shop.description }}</p>
      <p v-if="shop.referral_code && !amazonShop(shop)" class="affiliate-code">Referral code: <code>{{ shop.referral_code }}</code><small>Enter at the shop’s checkout. Eligibility and expiry follow the shop’s terms.</small></p>
      <a class="button secondary small-button affiliate-button" :href="shop.href" target="_blank" rel="sponsored nofollow noopener" referrerpolicy="strict-origin-when-cross-origin" :aria-label="affiliateLinkDescription(shop) + ' (opens in a new tab)'" :aria-describedby="disclosureId">{{ affiliateLinkLabel(shop) }} <span aria-hidden="true">↗</span></a>
    </div>
  </article>
</template>
<style scoped>
.marketplace-affiliate{min-width:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--paper);color:var(--ink)}.affiliate-photo{position:relative;padding:14px;background:linear-gradient(135deg,var(--surface-soft),var(--paper))}.affiliate-photo img,.affiliate-photo-placeholder{display:block;width:100%;height:auto;aspect-ratio:5/7;object-fit:contain;border-radius:8px}.affiliate-photo-placeholder{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:24px 8px;color:var(--muted);font-size:12px;text-align:center}.affiliate-label{position:absolute;top:21px;left:21px;max-width:calc(100% - 42px);display:inline-block;font-size:10px;line-height:1.3;padding:5px 8px;border-radius:6px;background:var(--accent-soft);color:var(--primary)}.affiliate-copy{display:flex;flex-direction:column;flex:1;gap:8px;padding:16px;min-width:0}.affiliate-copy h2{margin:0;font-size:15px;color:var(--ink);overflow-wrap:anywhere}.affiliate-copy p{margin:0;font-size:12px;line-height:1.65;color:var(--muted);overflow-wrap:anywhere}.affiliate-description{white-space:pre-line;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.affiliate-code code{color:var(--ink);font-weight:650}.affiliate-code small{display:block;margin-top:4px;font-size:11px}.affiliate-button{margin-top:auto;width:100%;max-width:100%;justify-content:center;text-align:center;white-space:normal;overflow-wrap:anywhere;padding:10px 8px}.affiliate-button:focus-visible{outline:3px solid var(--primary);outline-offset:3px}@media(max-width:600px){.affiliate-copy{padding:12px}.affiliate-copy h2{font-size:13px}.affiliate-copy p,.affiliate-button{font-size:11px}.affiliate-photo{padding:10px}.affiliate-label{top:16px;left:16px;font-size:8px}.affiliate-photo-placeholder{font-size:11px}}
</style>
