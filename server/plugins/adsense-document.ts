import { adsenseSettings } from '../../lib/adsense.mjs'
import { nonceScriptTags } from '../../lib/adsense-logic.mjs'
export default defineNitroPlugin(nitro => {
  nitro.hooks.hook('render:html', async (html, { event }) => {
    const path = event.path.split('?')[0] || ''
    // Verification is inert metadata, not an ad loader. Visitors/paid users may
    // see this public publisher ID, but never get Google advertising JavaScript.
    if (path === '/' || path === '/explore' || path === '/explore/') {
      try {
        const settings = await adsenseSettings()
        if (settings.verification_enabled && /^ca-pub-\d{16}$/.test(settings.publisher_id)) {
          html.head.push(`<meta name="google-adsense-account" content="${settings.publisher_id}">`)
        }
      } catch { /* No configuration means no verification tag. */ }
    }
    const state = event.context.cardshelfAdsense
    if (!state?.nonce) return
    for (const key of ['head', 'body', 'bodyPrepend', 'bodyAppend'] as const) {
      html[key] = html[key].map(part => nonceScriptTags(part, state.nonce))
    }
    html.head.push(`<meta name="cardshelf-adsense-revision" content="${state.revision}">`)
    html.head.push(`<meta name="cardshelf-ad-provider" content="${state.provider === 'adsterra' ? 'adsterra' : 'adsense'}">`)
  })
})
