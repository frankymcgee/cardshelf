<script setup lang="ts">
const route = useRoute(), auth = useAuth(), menuOpen = ref(false)
const menuButton = ref<HTMLButtonElement | null>(null)
const signedIn = computed(() => !!auth.state.value.user)
watch(() => route.fullPath, () => { menuOpen.value = false })
onMounted(async () => { try { await auth.refresh() } catch { /* Marketing remains available when session lookup is unavailable. */ } })
function closeMenu() { menuOpen.value = false; menuButton.value?.focus() }
</script>
<template>
  <div class="marketing-site">
    <a href="#marketing-main" class="m-skip">Skip to content</a>
    <header class="m-header" @keydown.esc="closeMenu">
      <div class="m-container m-nav">
        <NuxtLink to="/" class="m-logo" aria-label="CardShelf home"><img src="/icon.svg" width="36" height="36" alt="" />CardShelf</NuxtLink>
        <button ref="menuButton" type="button" class="m-menu-toggle" :aria-expanded="menuOpen" aria-controls="marketing-navigation" aria-label="Toggle navigation" @click="menuOpen = !menuOpen"><AppIcon :name="menuOpen ? 'close' : 'list'" /></button>
        <nav id="marketing-navigation" class="m-nav-links" :class="{ 'is-open': menuOpen }" aria-label="Website navigation">
          <NuxtLink to="/explore">Browse cards</NuxtLink><NuxtLink to="/features">The platform</NuxtLink><NuxtLink to="/pricing">Plans & access</NuxtLink><NuxtLink to="/pokemon-arena">Arena<span class="m-nav-new">NEW</span></NuxtLink>
          <NuxtLink :to="signedIn ? '/app' : '/login'" class="m-signin">{{ signedIn ? 'My collection' : 'Sign in' }}<AppIcon name="arrow" :size="16" /></NuxtLink>
          <NuxtLink to="/register" class="m-button m-button-small">Free account</NuxtLink><ThemePicker />
        </nav>
      </div>
    </header>
    <main id="marketing-main" tabindex="-1"><slot /><AdSenseSlot v-if="['/', '/features', '/pricing'].includes(route.path)" :content-ready="true" auto-only /></main>
    <footer class="m-footer"><div class="m-container">
      <div class="m-footer-top"><div><NuxtLink to="/" class="m-logo"><img src="/icon.svg" width="32" height="32" alt="" />CardShelf</NuxtLink><p>Your collection. Your next match.<br>A little more room for the hobby.</p></div>
        <nav aria-label="Footer navigation"><NuxtLink to="/features">The platform</NuxtLink><NuxtLink to="/pokemon-arena">Pokémon Arena</NuxtLink><NuxtLink to="/pricing">Plans & access</NuxtLink><NuxtLink to="/#questions">Questions</NuxtLink><NuxtLink to="/contact">Contact</NuxtLink><NuxtLink to="/privacy">Privacy & data</NuxtLink><NuxtLink to="/login">Sign in</NuxtLink></nav>
        <div class="m-footer-note"><span class="m-live-dot" />YOUR COLLECTION. YOUR NEXT MATCH.<p>Built for collectors.<br>Shaped by people using it.</p></div>
      </div>
      <div class="m-footer-bottom"><span>CardShelf · Independent collector software</span><span>Not affiliated with Pokémon, Konami, Wizards of the Coast or the pricing providers.</span></div>
    </div></footer>
  </div>
</template>
