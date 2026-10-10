import { pruneAccountSecurity } from '../../lib/account-security.mjs'
export default defineNitroPlugin(nitro => {
  let running: Promise<void> | null = null
  const timer = setInterval(() => {
    if (running) return
    running = pruneAccountSecurity().catch(() => {
      console.error('Account security cleanup needs administrator attention.')
    }).finally(() => { running = null })
  }, 60000)
  timer.unref()
  nitro.hooks.hook('close', async () => { clearInterval(timer); await running })
})
