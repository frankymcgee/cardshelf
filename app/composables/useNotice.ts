export function useNotice() {
  const notices = useState<any[]>('notices', () => [])
  function dismiss(id: string) { notices.value = notices.value.filter(n => n.id !== id) }
  function show(message: string, kind = 'success') {
    const id = Math.random().toString(36).slice(2)
    notices.value.push({ id, message, kind })
    setTimeout(() => dismiss(id), kind === 'error' ? 11000 : 4500)
  }
  return { notices, dismiss, show }
}
