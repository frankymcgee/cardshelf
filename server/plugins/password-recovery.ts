import { recoveryMailTick } from '../../lib/password-recovery.mjs'
export default defineNitroPlugin(nitro => {
  if (process.env.EMAIL_WORKER_ENABLED === 'false') return
  let running: Promise<void> | null = null
  const timer = setInterval(() => {
    if (running) return
    running = recoveryMailTick().catch(() => {
      // Never print mail bodies, reset links, SMTP responses or user passwords.
      console.error('Password recovery queue needs administrator attention.')
    }).finally(() => { running = null })
  }, 5000)
  timer.unref()
  nitro.hooks.hook('close', async () => { clearInterval(timer); await running })
})
