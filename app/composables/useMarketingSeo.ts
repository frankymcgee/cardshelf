export function useMarketingSeo(title: string, description: string, path = '/') {
  const config = useRuntimeConfig()
  let origin = 'https://tcg.webwire.cloud'
  try {
    const url = new URL(String(config.public.siteUrl))
    if (['https:','http:'].includes(url.protocol) && !url.username && !url.password) origin = url.origin
  } catch { /* Keep the configured production fallback; never trust request Host. */ }
  const canonical = origin + path
  useSeoMeta({ title: title + ' · CardShelf', description, robots: 'index, follow',
    ogTitle: title + ' · CardShelf', ogDescription: description, ogType: 'website', ogSiteName: 'CardShelf',
    ogUrl: canonical, ogImage: origin + '/icon-512.png', twitterCard: 'summary',
    twitterTitle: title + ' · CardShelf', twitterDescription: description })
  useHead({ link: [{ rel: 'canonical', href: canonical }] })
  return { origin, canonical }
}
