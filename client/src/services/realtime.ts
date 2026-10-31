/**
 * WebSocket client for live updates. One per signed-in session.
 *
 * Sends the access token in the first message (not the URL), reconnects with exponential
 * backoff and jitter, and reports whether it is live. The server drops the socket when the
 * token expires; the client then refreshes the token and reconnects.
 */

export interface RealtimeEvent {
  type: 'ready' | 'entry' | 'party' | 'company' | 'access' | 'stock' | 'wastage'
  /** Needs attention now: "escalated" (sent back by the Manager or Finance). */
  alert?: string | null
  action?: string
  company_id?: number
  entry_type?: 'purchase' | 'sale' | 'production'
  entry_id?: number
  ref_no?: string
  status?: string
  created_by_id?: number | null
  actor_id?: number
  actor_name?: string
  /** On "wastage": the month it is about (YYYY-MM-01). */
  month?: string
  /** On "ready": true when this is a reconnect, so missed changes must be refetched. */
  reconnected?: boolean
}

export type RealtimeStatus = 'offline' | 'connecting' | 'live'

const UNAUTHORIZED = 4401
const TOKEN_EXPIRED = 4408
const MAX_DELAY_MS = 30_000

export class RealtimeClient {
  private socket?: WebSocket
  private attempt = 0
  private everConnected = false
  private retry?: ReturnType<typeof setTimeout>
  private stopped = true
  private status: RealtimeStatus = 'offline'
  private readonly listeners = new Set<(e: RealtimeEvent) => void>()
  private readonly statusListeners = new Set<() => void>()

  private readonly url: string
  private readonly getToken: () => string | null
  /** Called when the server refuses the token; should refresh it (e.g. by any API call). */
  private readonly refreshToken: () => Promise<unknown>

  constructor(url: string, getToken: () => string | null, refreshToken: () => Promise<unknown>) {
    this.url = url
    this.getToken = getToken
    this.refreshToken = refreshToken
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.retry)
    this.socket?.close(1000)
    this.socket = undefined
    this.setStatus('offline')
  }

  onEvent(listener: (e: RealtimeEvent) => void) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** For useSyncExternalStore. */
  subscribeStatus = (listener: () => void) => {
    this.statusListeners.add(listener)
    return () => void this.statusListeners.delete(listener)
  }

  getStatus = () => this.status

  private setStatus(next: RealtimeStatus) {
    if (next === this.status) return
    this.status = next
    this.statusListeners.forEach((l) => l())
  }

  private connect() {
    const token = this.getToken()
    if (this.stopped || !token) return
    this.setStatus('connecting')
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }))
    socket.onmessage = (msg) => {
      let event: RealtimeEvent
      try {
        event = JSON.parse(String(msg.data))
      } catch {
        return
      }
      if (event.type === 'ready') {
        event.reconnected = this.everConnected
        this.everConnected = true
        this.attempt = 0
        this.setStatus('live')
      }
      if ((event.type as string) !== 'ping') this.listeners.forEach((l) => l(event))
    }
    socket.onclose = (ev) => {
      if (this.socket !== socket || this.stopped) return
      this.setStatus('connecting')
      if (ev.code === UNAUTHORIZED || ev.code === TOKEN_EXPIRED) {
        // Get a fresh access token first; an API call refreshes it on its own.
        this.refreshToken().finally(() => this.schedule())
      } else {
        this.schedule()
      }
    }
  }

  private schedule() {
    if (this.stopped) return
    // 1s, 2s, 4s … up to 30s, each with ±50% jitter so many clients don't reconnect in step.
    const base = Math.min(MAX_DELAY_MS, 1000 * 2 ** this.attempt)
    this.attempt += 1
    this.retry = setTimeout(() => this.connect(), base * (0.5 + Math.random() / 2))
  }
}

/** The app's one client. Created lazily so tests and the login page never open a socket. */
let shared: RealtimeClient | null = null

export async function getRealtime(): Promise<RealtimeClient> {
  if (!shared) {
    const [{ store }, { api }, { config }, { API_ROUTES }] = await Promise.all([
      import('../statemanager/store'),
      import('./api'),
      import('../utils/config'),
      import('../utils/apiRoutes'),
    ])
    shared = new RealtimeClient(config.realtimeUrl, () => store.getState().auth.accessToken, () => api.get(API_ROUTES.auth.me).catch(() => undefined))
  }
  return shared
}

export const currentRealtime = () => shared
