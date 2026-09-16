export default defineNuxtConfig({
  compatibilityDate: '2026-09-16',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  nitro: { preset: 'node-server', externals: { external: ['postgres'] } },
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
