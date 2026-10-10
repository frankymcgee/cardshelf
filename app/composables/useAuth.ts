export function useAuth() {
  const state = useState<any>('auth', () => ({ loaded: false, user: null, pending: null, setup_required: false }))
  const api = useApi(), requestVersion = useState<number>('auth-request-version', () => 0)
  async function refresh() {
    const current = ++requestVersion.value
    const response = await api('/api/session')
    if (current === requestVersion.value) state.value = { ...response, loaded: true }
    return state.value
  }
  async function logout() {
    requestVersion.value++
    await api('/api/logout', { method: 'POST', body: {} })
    // The server session deletion already removes delivery subscriptions.
    // Clear this browser's subscription and previously displayed notifications.
    if (import.meta.client && 'serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration('/')
        await (await registration?.pushManager.getSubscription())?.unsubscribe()
        for (const notification of await registration?.getNotifications() || []) notification.close()
      } catch { /* Server-side revocation remains authoritative. */ }
    }
    requestVersion.value++
    state.value = { loaded: true, user: null, pending: null, setup_required: false }
    clearNuxtData()
    await navigateTo('/')
  }
  return { state, refresh, logout }
}
