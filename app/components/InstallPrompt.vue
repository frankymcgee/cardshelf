<script setup lang="ts">
const props = withDefaults(defineProps<{ banner?: boolean }>(), { banner: false })
const { state: pwa, install, dismiss } = usePwa()
const visible = computed(() => pwa.value.ready && (!props.banner || (pwa.value.secure && !pwa.value.installed && !pwa.value.dismissed && (pwa.value.mobile || pwa.value.canPrompt))))
const instructionsId = useId()
</script>
<template>
  <section v-if="visible" class="panel install-prompt" :class="{ 'install-banner': banner }" aria-label="Install CardShelf">
    <div class="install-heading"><img src="/icon-192.png" width="48" height="48" alt="" /><div><h2>{{ pwa.installed ? 'CardShelf is installed' : 'Your collection, one tap away' }}</h2><p>{{ pwa.installed ? 'You’re using the CardShelf app.' : 'Add CardShelf to your Home Screen for quick access to your cards.' }}</p></div><button v-if="banner" type="button" class="icon-button" aria-label="Dismiss install prompt for 30 days" @click="dismiss"><AppIcon name="close" /></button></div>
    <p v-if="!pwa.secure" class="small muted">Open CardShelf over HTTPS to install the app and use notifications.</p>
    <div v-else-if="!pwa.installed" class="button-row install-actions"><button class="button primary" type="button" :disabled="pwa.busy" :aria-expanded="pwa.canPrompt ? undefined : pwa.instructions" :aria-controls="instructionsId" @click="install"><AppIcon name="download" :size="18" />{{ pwa.busy ? 'Opening…' : pwa.canPrompt ? 'Install CardShelf' : 'How to install' }}</button><button v-if="banner" class="text-button" type="button" @click="dismiss">Maybe later</button></div>
    <div v-if="pwa.instructions && !pwa.installed" :id="instructionsId" class="install-instructions">
      <ol v-if="pwa.ios"><li>Open CardShelf in Safari.</li><li>Open <strong>Share</strong> (it may be inside the <strong>…</strong> menu), then choose <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>, then open CardShelf from its new Home Screen icon.</li></ol>
      <ol v-else><li>Open your browser’s menu.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>, then confirm.</li><li>Open CardShelf from your Home Screen or app launcher.</li></ol>
      <p class="small muted">{{ pwa.ios ? 'On iPhone and iPad, notifications need iOS / iPadOS 16.4 or later and the Home Screen app.' : 'If no install option appears, try a current browser such as Chrome or Edge. Installation depends on your browser and device.' }}</p>
    </div>
    <p v-if="pwa.message" class="small" role="status">{{ pwa.message }}</p>
  </section>
</template>
<style scoped>
.install-prompt{padding:24px}.install-banner{margin-bottom:24px;border-color:var(--primary);background:var(--paper)}.install-heading{display:flex;gap:16px;align-items:center}.install-heading img{border-radius:12px;flex-shrink:0}.install-heading>div{flex:1;min-width:0}.install-heading h2{font-size:19px;margin:0 0 6px}.install-heading p{font-size:13px;color:var(--muted);line-height:1.6;margin:0}.install-heading .icon-button{align-self:flex-start;min-width:44px;min-height:44px}.install-actions{margin-top:18px}.install-actions button{min-height:44px}.install-instructions{margin-top:20px;padding-top:16px;border-top:1px solid var(--line)}.install-instructions ol{padding-left:22px;font-size:14px;line-height:1.7}.install-instructions li+li{margin-top:8px}@media(max-width:480px){.install-prompt{padding:18px}.install-heading{gap:12px;align-items:flex-start}.install-heading img{width:38px;height:38px}.install-heading h2{font-size:17px}.install-heading .icon-button{margin:-8px -8px 0 0}}
</style>
