<script setup lang="ts">
import { COLLECTION_LINKS, MORE_GROUPS, administrationLinks, navigationMatches } from '../../shared/navigation.mjs'
const props = defineProps<{ section: string | null; role?: string; signingOut?: boolean }>()
const emit = defineEmits<{ close: []; logout: [] }>()
const route = useRoute(), dialog = ref<HTMLDialogElement | null>(null)
const adminLinks = computed(() => administrationLinks(props.role))
const isCollection = computed(() => props.section === 'collection')
const title = computed(() => isCollection.value ? 'Your collection' : 'More from CardShelf')
function syncScrollLock() { document.body.classList.toggle('has-modal', !!document.querySelector('dialog[open]')) }
function close() { dialog.value?.close(); syncScrollLock(); emit('close') }
function outside(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return
  const box = dialog.value.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
}
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || !dialog.value) return
  const items = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(el => el.getClientRects().length > 0)
  const first = items[0], last = items.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
let alive = true
watch(() => props.section, async section => {
  await nextTick()
  if (!alive || !dialog.value) return
  if (section && !dialog.value.open) dialog.value.showModal()
  if (!section && dialog.value.open) dialog.value.close()
  syncScrollLock()
}, { immediate: true })
watch(() => route.fullPath, close)
onBeforeUnmount(() => { alive = false; dialog.value?.close(); syncScrollLock() })
</script>
<template>
  <Teleport to="body">
    <dialog id="cardshelf-navigation" ref="dialog" class="navigation-sheet" aria-labelledby="navigation-title" @cancel.prevent="close" @click="outside" @keydown="trapFocus" @close="syncScrollLock">
      <header class="navigation-sheet-header"><div><span class="eyebrow">CARDSHELF</span><h2 id="navigation-title">{{ title }}</h2></div><button type="button" class="icon-button" autofocus aria-label="Close navigation" @click="close"><AppIcon name="close" /></button></header>
      <div class="navigation-sheet-body">
        <p class="navigation-intro">{{ isCollection ? 'Everything you collect, in one place.' : 'Account settings, tools and preferences.' }}</p>
        <nav v-if="isCollection" class="navigation-cards" aria-label="Collection tools">
          <NuxtLink v-for="item in COLLECTION_LINKS" :key="item.to" :to="item.to" class="navigation-card" :aria-current="navigationMatches(route.path, item.to) ? 'page' : undefined" @click="close"><span class="navigation-card-icon"><AppIcon :name="item.icon" :size="24" /></span><span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span><AppIcon name="right" :size="16" /></NuxtLink>
        </nav>
        <template v-else>
          <section v-for="group in MORE_GROUPS" :key="group.id" class="navigation-group"><h3>{{ group.title }}</h3><nav class="navigation-cards" :aria-label="group.title"><NuxtLink v-for="item in group.links" :key="item.to" :to="item.to" class="navigation-card" :aria-current="navigationMatches(route.path, item.to) ? 'page' : undefined" @click="close"><span class="navigation-card-icon"><AppIcon :name="item.icon" :size="22" /></span><span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span><AppIcon name="right" :size="16" /></NuxtLink></nav></section>
          <details v-if="adminLinks.length" class="navigation-admin" :open="route.path.startsWith('/admin/')"><summary><AppIcon name="shield" :size="20" /><span>Administration<small>Platform, billing and moderation tools</small></span><AppIcon name="right" :size="16" /></summary><nav class="navigation-cards" aria-label="Administration"><NuxtLink v-for="item in adminLinks" :key="item.to" :to="item.to" class="navigation-card" @click="close"><span class="navigation-card-icon"><AppIcon :name="item.icon" :size="22" /></span><span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span></NuxtLink></nav></details>
          <section class="navigation-preferences" aria-label="Appearance and session"><ThemePicker /><button type="button" class="button secondary" :disabled="signingOut" @click="emit('logout')"><AppIcon name="logout" :size="18" />{{ signingOut ? 'Signing out…' : 'Sign out' }}</button></section>
        </template>
      </div>
    </dialog>
  </Teleport>
</template>
<style>
.navigation-sheet{padding:0;border:1px solid var(--line);border-radius:24px;background:var(--paper);color:var(--ink);width:min(720px,calc(100vw - 40px));max-height:calc(100dvh - 48px);overflow:hidden;box-shadow:0 24px 100px #14112545}
.navigation-sheet[open]{display:flex;flex-direction:column}.navigation-sheet::backdrop{background:#14112580;backdrop-filter:blur(3px)}
.navigation-sheet-header{display:flex;justify-content:space-between;align-items:center;padding:24px 26px 18px;border-bottom:1px solid var(--line);flex-shrink:0}.navigation-sheet-header .eyebrow{margin-bottom:5px}.navigation-sheet-header h2{margin:0;font-size:23px}.navigation-sheet-header .icon-button{width:44px;height:44px}
.navigation-sheet-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:22px 26px max(24px,env(safe-area-inset-bottom));scrollbar-gutter:stable}.navigation-intro{font-size:13px;color:var(--muted);margin-bottom:18px}
.navigation-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.navigation-card{display:flex;align-items:center;gap:12px;min-width:0;min-height:92px;padding:16px;border:1px solid var(--line);border-radius:15px;background:var(--bg);transition:border-color .15s,background .15s}.navigation-card:hover,.navigation-card[aria-current=page]{border-color:var(--primary);background:var(--paper)}.navigation-card>span:nth-child(2){min-width:0;flex:1}.navigation-card-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;flex:none;color:var(--primary);background:var(--paper)}.navigation-card strong{display:block;font-size:13px;line-height:1.4;overflow-wrap:anywhere}.navigation-card small{display:block;font-size:11px;line-height:1.5;color:var(--muted);margin-top:4px}.navigation-card>svg{color:var(--muted)}
.navigation-group{margin-bottom:24px}.navigation-group h3{font-size:12px;margin-bottom:12px;color:var(--muted)}.navigation-admin{border:1px solid var(--line);border-radius:15px;margin:20px 0}.navigation-admin summary{display:flex;align-items:center;gap:12px;min-height:66px;padding:16px;cursor:pointer;font-size:13px;font-weight:650;list-style:none}.navigation-admin summary::-webkit-details-marker{display:none}.navigation-admin summary span{flex:1}.navigation-admin summary small{display:block;color:var(--muted);font-weight:400}.navigation-admin[open] summary>svg:last-child{transform:rotate(90deg)}.navigation-admin .navigation-cards{padding:0 14px 14px}.navigation-admin .navigation-card{min-height:80px;padding:12px}
.navigation-preferences{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;border-top:1px solid var(--line);padding-top:16px}.navigation-preferences .theme-picker>span{position:static;width:auto;height:auto;clip:auto;overflow:visible}.navigation-preferences .theme-picker select{min-height:44px}.navigation-preferences .button{min-height:44px;background:var(--paper);color:var(--ink)}
@media(max-width:760px){.navigation-sheet{width:100%;max-width:none;max-height:calc(100dvh - max(12px,env(safe-area-inset-top)));margin:auto 0 0;border-radius:22px 22px 0 0;border-bottom:0}.navigation-sheet-header{padding:18px 18px 14px}.navigation-sheet-body{padding:16px 18px max(24px,env(safe-area-inset-bottom))}.navigation-sheet-header h2{font-size:21px}.navigation-card{padding:13px;min-height:96px}.navigation-card>svg{display:none}.navigation-card-icon{width:34px;height:36px}.navigation-cards{gap:10px}.navigation-card strong{font-size:12px}}
@media(max-width:420px){.navigation-cards{grid-template-columns:1fr}.navigation-card{min-height:76px}.navigation-card>svg{display:block}.navigation-admin .navigation-card{min-height:76px}}
@media(prefers-reduced-motion:reduce){.navigation-card{transition:none}}
</style>
