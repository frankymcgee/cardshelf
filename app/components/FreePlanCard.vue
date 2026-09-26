<script setup lang="ts">
defineProps<{ preview?: boolean }>()
</script>
<template>
  <article class="m-plan stripe-plan free-plan" data-testid="free-plan">
    <span class="m-plan-label">ALWAYS FREE</span><h2>Free</h2>
    <p class="free-description">Explore cards and discover your next collection.</p>
    <div class="free-amount"><strong>$0</strong><span>forever</span></div>
    <p class="free-note">No payment details required.</p>
    <ul><li v-for="feature in ['Browse every supported card game', 'Card artwork and available source prices', 'Public marketplace browsing', 'Optional Free account']" :key="feature"><AppIcon name="check" :size="18"/><span>{{ feature }}</span></li></ul>
    <p class="free-note">Catalogue access with labelled advertising. Photo scanning and collection management are not included.</p>
    <div class="free-footer"><p v-if="preview" class="m-fine">Built-in CardShelf tier. No Stripe product or subscription is needed.</p><template v-else><NuxtLink to="/explore" class="m-button">Browse for free<AppIcon name="arrow" :size="18"/></NuxtLink><NuxtLink to="/register" class="m-text-link">Free account options</NuxtLink></template></div>
  </article>
</template>
<style scoped>
.free-plan{display:flex;flex-direction:column;min-width:0}.free-description{min-height:54px}.free-amount{display:flex;align-items:baseline;gap:10px;margin-top:24px}.free-amount strong{font-size:44px;letter-spacing:-.04em}.free-amount span,.free-note{font-size:13px;color:var(--m-muted)}.free-note{line-height:1.6}.free-plan ul{margin:24px 0!important}.free-footer{margin-top:auto;padding-top:18px}.free-footer .m-button{width:100%;justify-content:center}.free-footer .m-text-link{display:inline-flex;margin-top:18px}.free-footer .m-fine{font-weight:650}@media(max-width:760px){.free-description{min-height:0}}
</style>
