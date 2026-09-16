export function useAuth() {
  const state = useState<any>('auth', () => ({ loaded: false, user: null, setup_required: false }))
  const api = useApi()
  async function refresh() {
    const response = await api('/api/session')
    state.value = { ...response, loaded: true }
    return state.value
  }
  async function logout() {
    await api('/api/logout', { method: 'POST', body: {} })
    state.value = { loaded: true, user: null, setup_required: false }
    clearNuxtData()
    await navigateTo('/')
  }
  return { state, refresh, logout }
}
