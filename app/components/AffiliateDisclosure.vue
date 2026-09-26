<script setup lang="ts">
import { AFFILIATE_DISCLOSURE, AMAZON_DISCLOSURE } from '../../shared/affiliate-shops.mjs'
defineProps<{ amazon?: boolean }>()
</script>
<template>
  <footer class="affiliate-footer" aria-label="Affiliate disclosure" data-testid="affiliate-disclosure">
    <p>{{ AFFILIATE_DISCLOSURE }}</p>
    <p v-if="amazon" class="amazon-disclosure" data-testid="amazon-disclosure">{{ AMAZON_DISCLOSURE }}</p>
    <p>Check the product, card size or printing, language, price and delivery options at the shop. These links do not confirm stock availability.</p>
  </footer>
</template>
<style scoped>
.affiliate-footer{margin-top:24px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;line-height:1.65}.affiliate-footer p{margin:0 0 8px}.affiliate-footer .amazon-disclosure{font-weight:650;color:var(--ink)}
</style>
