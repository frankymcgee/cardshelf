export function usePushNotifications() {
  const api = useApi(), auth = useAuth(), { state: pwa } = usePwa()
  const accountId = auth.state.value.user?.id
  const loading = ref(true), busy = ref(false), enabled = ref(false), supported = ref(false), available = ref(false), workerReady = ref(false)
  const permission = ref<NotificationPermission>('default'), error = ref(''), notice = ref(''), conflict = ref(false)
  const preferences = reactive({ marketplace: true, membership: true })
  let registration: ServiceWorkerRegistration | undefined, subscription: PushSubscription | null = null, publicKey = '', revision = 0, alive = true
  function apply(result: any) {
    enabled.value = result.enabled === true
    if (enabled.value) { preferences.marketplace = result.marketplace; preferences.membership = result.membership; revision = result.revision }
  }
  async function load() {
    if (busy.value) return
    loading.value = true; error.value = ''; conflict.value = false; workerReady.value = false
    supported.value = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (!supported.value || (pwa.value.ios && !pwa.value.installed)) { loading.value = false; return }
    permission.value = Notification.permission
    try {
      const config: any = await api('/api/account/push'); if (!alive) return
      available.value = config.available; publicKey = config.public_key || ''
      // Ready can otherwise hang indefinitely if a browser blocks registration.
      registration = await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The app could not prepare notifications. Reload and try again.')), 10000))])
      if (!alive) return
      workerReady.value = true; subscription = await registration.pushManager.getSubscription()
      if (subscription && permission.value !== 'granted') {
        await api('/api/account/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } })
        await subscription.unsubscribe(); subscription = null; enabled.value = false
      } else if (subscription) apply(await api('/api/account/push/status', { method: 'POST', body: { endpoint: subscription.endpoint } }))
      else enabled.value = false
    } catch (e) { if (alive) error.value = errorMessage(e) }
    finally { if (alive) loading.value = false }
  }
  async function enable() {
    if (busy.value || !registration || !available.value || !supported.value) return
    busy.value = true; error.value = ''; notice.value = ''
    let created: PushSubscription | null = null
    try {
      // Safari requires this request to occur directly in the user's gesture.
      permission.value = await Notification.requestPermission()
      if (permission.value !== 'granted') { notice.value = permission.value === 'denied' ? 'Notifications are blocked. Allow them in your browser or device settings, then try again.' : 'Notifications were not enabled. You can try again whenever you’re ready.'; return }
      // Never silently transfer an old browser subscription to another sign-in.
      if (subscription && !enabled.value) { await subscription.unsubscribe(); subscription = null }
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
      created = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      const result = await api('/api/account/push/subscribe', { method: 'POST', body: { account_id: accountId, subscription: created.toJSON(), preferences: { ...preferences } } })
      subscription = created; apply(result); notice.value = 'Notifications are on for this device.'
    } catch (e) {
      if (created) await created.unsubscribe().catch(() => {})
      error.value = errorMessage(e)
    } finally { busy.value = false }
  }
  async function disable() {
    if (busy.value || !subscription) return
    busy.value = true; error.value = ''; notice.value = ''
    try {
      await api('/api/account/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } })
      enabled.value = false
      await subscription.unsubscribe(); subscription = null
      for (const notification of await registration?.getNotifications() || []) notification.close()
      notice.value = 'Notifications are off for this device.'
    } catch (e) { error.value = errorMessage(e) }
    finally { busy.value = false }
  }
  async function save() {
    if (busy.value || !enabled.value || !subscription || conflict.value) return
    busy.value = true; error.value = ''; notice.value = ''
    try { apply(await api('/api/account/push/preferences', { method: 'POST', body: { endpoint: subscription.endpoint, preferences: { ...preferences }, revision } })); notice.value = 'Notification preferences saved for this device.' }
    catch (e: any) { error.value = errorMessage(e); conflict.value = (e?.statusCode || e?.status) === 409 }
    finally { busy.value = false }
  }
  async function testNotification() {
    if (busy.value || !enabled.value || !subscription) return
    busy.value = true; error.value = ''; notice.value = ''
    try { await api('/api/account/push/test', { method: 'POST', body: { endpoint: subscription.endpoint } }); notice.value = 'Test notification queued. It should arrive shortly; check your device’s notification settings if it doesn’t.' }
    catch (e) { error.value = errorMessage(e) }
    finally { busy.value = false }
  }
  onMounted(load)
  onBeforeUnmount(() => { alive = false })
  return { loading, busy, enabled, supported, available, workerReady, permission, preferences, error, notice, conflict, load, enable, disable, save, testNotification }
}
