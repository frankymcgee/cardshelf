export function useApi() {
  return async function request<T = any>(url: string, options: any = {}): Promise<T> {
    return await $fetch<T>(url, { ...options, headers: { 'X-Requested-With': 'cardshelf', ...(options.headers || {}) }, retry: 0 }) as T
  }
}
export function errorMessage(error: any): string {
  if (error?.data?.data?.code === 'STRONG_AUTH_REQUIRED' || error?.data?.code === 'STRONG_AUTH_REQUIRED') {
    return 'Verify your password and an existing factor in Account security (/security), then return here and try this action again.'
  }
  return error?.data?.message || error?.message || 'Something went wrong. Please try again.'
}
