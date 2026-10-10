import { verificationMailTick } from '../../lib/email-verification.mjs'
export default defineNitroPlugin(nitro => {
  if (process.env.EMAIL_WORKER_ENABLED === 'false') return
  let running: Promise<void> | null = null
  const timer = setInterval(() => {
    if (running) return
    running = verificationMailTick().catch(() => {
      console.error('Email verification queue needs administrator attention.')
    }).finally(() => { running = null })
  }, 5000)
  timer.unref()
  nitro.hooks.hook('close', async () => { clearInterval(timer); await running })
})
