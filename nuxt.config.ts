export default defineNuxtConfig({
  compatibilityDate: '2026-09-16',
  ssr: true,
  runtimeConfig: { public: { siteUrl: 'https://tcg.webwire.cloud' } },
  // Searchable public pages; private collector/account pages stay client-rendered.
  routeRules: {
    '/app': { ssr: false }, '/app/**': { ssr: false },
    '/login': { ssr: false }, '/cards': { ssr: false }, '/cards/**': { ssr: false },
    '/binders': { ssr: false }, '/binders/**': { ssr: false },
    '/marketplace': { ssr: false }, '/marketplace/**': { ssr: false },
    '/games': { ssr: false }, '/register': { ssr: false },
    '/forgot-password': { ssr: false }, '/reset-password': { ssr: false },
    '/settings': { ssr: false }, '/account': { ssr: false },
    '/membership': { ssr: false }, '/referrals': { ssr: false },
    '/admin/**': { ssr: false }, '/print/**': { ssr: false }, '/shared/**': { ssr: false }
  },
  // Keep shared-module paths absolute until Nitro bundles the SSR output.
  vite: { $server: { build: { rolldownOptions: { makeAbsoluteExternalsRelative: false } } } },
  devtools: { enabled: false },
  css: ['~/assets/css/main.css', '~/assets/css/features.css', '~/assets/css/appearance.css', '~/assets/css/marketing.css', '~/assets/css/themes.css', '~/assets/css/games.css'],
  nitro: { preset: 'node-server', externals: { external: ['postgres', 'sharp', 'nodemailer'] } },
  typescript: { strict: true, tsConfig: { compilerOptions: { allowJs: true, checkJs: false } } },
  app: { head: {
    title: 'CardShelf', htmlAttrs: { lang: 'en' },
    script: [{ src: '/theme-init.js?v=0.12.0', tagPriority: 'critical' }],
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
