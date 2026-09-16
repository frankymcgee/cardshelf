export default defineNuxtConfig({
  compatibilityDate: '2026-09-16',
  ssr: true,
  runtimeConfig: { public: { siteUrl: 'https://tcg.webwire.cloud' } },
  // Searchable public pages, with the existing collector application kept client-rendered.
  routeRules: {
    '/app': { ssr: false }, '/app/**': { ssr: false },
    '/login': { ssr: false }, '/cards': { ssr: false }, '/cards/**': { ssr: false },
    '/binders': { ssr: false }, '/binders/**': { ssr: false },
    '/settings': { ssr: false }, '/account': { ssr: false },
    '/admin/**': { ssr: false }, '/print/**': { ssr: false }, '/shared/**': { ssr: false }
  },
  devtools: { enabled: false },
  css: ['~/assets/css/main.css', '~/assets/css/features.css', '~/assets/css/appearance.css', '~/assets/css/marketing.css'],
  nitro: { preset: 'node-server', externals: { external: ['postgres', 'sharp'] } },
  typescript: { strict: true, tsConfig: { compilerOptions: { allowJs: true, checkJs: false } } },
  app: { head: {
    title: 'CardShelf',
    htmlAttrs: { lang: 'en' },
    meta: [
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#5546d8' },
      { name: 'description', content: 'Your cards. Your binders. Your server.' },
      { name: 'robots', content: 'noindex, nofollow' }
    ],
    link: [
      { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
      { rel: 'apple-touch-icon', href: '/icon-192.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' }
    ]
  } }
})
