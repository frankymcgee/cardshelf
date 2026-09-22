<script setup lang="ts">
import { PRIMARY_NAVIGATION, activeNavigation } from '../../shared/navigation.mjs'
const auth = useAuth(), notice = useNotice(), route = useRoute()
const section = ref<string | null>(null), signingOut = ref(false)
const active = computed(() => activeNavigation(route.path))
const initial = computed(() => auth.state.value.user?.name?.slice(0, 1)?.toUpperCase() || 'C')
useSeoMeta({ robots: 'noindex, nofollow' })
function openSheet(id?: string) { if (!id) return; section.value = section.value === id ? null : id }
watch(() => route.fullPath, () => { section.value = null })
watch(() => [auth.state.value.user?.id, auth.state.value.user?.role], () => { section.value = null })
async function logout() {
  if (signingOut.value) return
  signingOut.value = true
  try { await auth.logout(); section.value = null }
  catch (e) { notice.show(errorMessage(e), 'error') }
  finally { signingOut.value = false }
}
</script>
<template>
  <div class="app-shell consolidated-shell">
    <aside class="sidebar">
      <NuxtLink to="/app" class="brand"><img src="/icon.svg" alt="" /><span>CardShelf<small>YOUR PRIVATE COLLECTION</small></span></NuxtLink>
      <div class="nav-caption">WORKSPACE</div>
      <nav aria-label="Main navigation" class="workspace-navigation">
        <template v-for="item in PRIMARY_NAVIGATION" :key="item.id">
          <NuxtLink v-if="item.to" :to="item.to" class="nav-item" :class="{ 'is-current': active === item.id }" :aria-current="active === item.id ? 'page' : undefined"><AppIcon :name="item.icon" /><span>{{ item.label }}</span></NuxtLink>
          <button v-else type="button" class="nav-item" :class="{ 'is-current': active === item.id || section === item.sheet }" aria-haspopup="dialog" aria-controls="cardshelf-navigation" :aria-expanded="section === item.sheet" @click="openSheet(item.sheet)"><AppIcon :name="item.icon" /><span>{{ item.label }}</span><AppIcon name="right" :size="15" /></button>
        </template>
      </nav>
      <p class="navigation-hint">Cards and binders in Collection.<br>Settings and tools in More.</p>
      <div class="sidebar-bottom"><div class="server-label"><span class="status-dot" />CardShelf <span>v0.24.0</span></div><button type="button" class="navigation-profile" aria-label="Open account and settings" aria-haspopup="dialog" aria-controls="cardshelf-navigation" :aria-expanded="section === 'more'" @click="openSheet('more')"><span class="avatar">{{ initial }}</span><span class="profile-name">{{ auth.state.value.user?.name }}<small>{{ auth.state.value.user?.role === 'admin' ? 'Administrator' : 'Account & preferences' }}</small></span><AppIcon name="grid" :size="18" /></button></div>
    </aside>
    <div class="workspace"><header class="mobile-header"><NuxtLink to="/app" class="brand"><img src="/icon.svg" alt="" /><span>CardShelf</span></NuxtLink><button type="button" class="navigation-avatar" aria-label="Open account and settings" aria-haspopup="dialog" aria-controls="cardshelf-navigation" :aria-expanded="section === 'more'" @click="openSheet('more')"><span class="avatar">{{ initial }}</span></button></header><main class="main-content"><FreeTierNotice /><slot /><SponsorSlot v-if="route.path === '/app' || route.path === '/cards'" :placement="route.path === '/app' ? 'overview' : 'catalogue'" /></main><footer class="app-footer">Your cards. Your binders. Your space.<span>Independent collector software · v0.24.0</span></footer></div>
    <nav class="mobile-nav" aria-label="Main navigation">
      <template v-for="item in PRIMARY_NAVIGATION" :key="item.id">
        <NuxtLink v-if="item.to" :to="item.to" :class="{ 'is-current': active === item.id }" :aria-current="active === item.id ? 'page' : undefined"><AppIcon :name="item.icon" :size="22" /><span>{{ item.label }}</span></NuxtLink>
        <button v-else type="button" :class="{ 'is-current': active === item.id || section === item.sheet }" aria-haspopup="dialog" aria-controls="cardshelf-navigation" :aria-expanded="section === item.sheet" @click="openSheet(item.sheet)"><AppIcon :name="item.icon" :size="22" /><span>{{ item.label }}</span></button>
      </template>
    </nav>
    <NavigationSheet :section="section" :role="auth.state.value.user?.role" :signing-out="signingOut" @close="section = null" @logout="logout" />
  </div>
</template>
<style scoped>
.sidebar{overflow-y:auto}.sidebar>*{flex-shrink:0}.workspace-navigation .nav-item{width:100%;text-align:left;min-height:48px}.workspace-navigation .nav-item>span{flex:1}.workspace-navigation .is-current{color:var(--primary);background:var(--bg);font-weight:700}.navigation-hint{font-size:11px;line-height:1.8;color:var(--muted);padding:20px 14px;margin:0}.sidebar-bottom{padding-top:28px}.navigation-profile{display:flex;align-items:center;gap:12px;width:100%;padding:16px 0 0;border-top:1px solid var(--line);min-height:62px;text-align:left}.navigation-profile .profile-name{flex:1}.navigation-profile>svg{color:var(--muted)}.navigation-avatar{display:grid;place-items:center;min-width:44px;min-height:44px;padding:5px}.mobile-header{justify-content:space-between}
@media(max-width:760px){.consolidated-shell .main-content{padding-bottom:24px}.consolidated-shell .workspace{padding-bottom:calc(78px + env(safe-area-inset-bottom))}.consolidated-shell .mobile-nav{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:2px;padding:6px max(6px,env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) max(6px,env(safe-area-inset-left));height:auto;background:var(--paper);border-top:1px solid var(--line)}.mobile-nav>a,.mobile-nav>button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:54px;min-width:0;width:auto;padding:6px 2px;border-radius:12px;font-size:11px;line-height:1.2;font-weight:600;color:var(--muted)}.mobile-nav>a.is-current,.mobile-nav>button.is-current{color:var(--primary);background:var(--bg)}.mobile-nav span{white-space:nowrap}.mobile-header .brand{font-size:20px}}
</style>
