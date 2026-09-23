<script setup lang="ts">
withDefaults(defineProps<{ eager?: boolean }>(), { eager: false })
</script>
<template>
  <figure class="m-arena-preview">
    <div class="m-arena-preview-bar"><span>CARDSHELF <b>ARENA</b></span><span>THE FIRST-PERSON TABLE</span></div>
    <img src="/marketing/arena-table-1672.webp" srcset="/marketing/arena-table-900.webp 900w, /marketing/arena-table-1672.webp 1672w" sizes="(max-width: 620px) calc(100vw - 36px), (max-width: 1296px) calc(100vw - 96px), 1200px" width="1672" height="941" :loading="eager ? 'eager' : 'lazy'" :fetchpriority="eager ? 'high' : 'auto'" decoding="async" alt="CardShelf Arena with a walnut table, blue fabric playmat, opponent cards, Prize piles and a selected Ember Cub in the foreground hand." />
    <figcaption>Captured from the Arena interface. Illustrative table with original CardShelf training cards; catalogue matches show their own card artwork.</figcaption>
  </figure>
</template>
