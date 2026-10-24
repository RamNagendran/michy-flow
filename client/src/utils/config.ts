const backendApi = (import.meta.env.VITE_BACKEND_API ?? 'http://localhost:8000').replace(/\/+$/, '')

export const config = {
  backendApi,
  /** Same host as the API: http → ws, https → wss. */
  realtimeUrl: `${backendApi.replace(/^http/, 'ws')}/ws`,
  idleLogoutMinutes: Number(import.meta.env.VITE_IDLE_LOGOUT_MINUTES ?? 30),
}
