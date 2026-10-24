import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { getRealtime, type RealtimeClient, type RealtimeEvent, type RealtimeStatus } from '../services/realtime'
import { endSession } from '../services/session'
import { useAppSelector } from '../statemanager/hooks'
import { resolveAccess } from './useAccess'
import { useNotify } from './useNotify'

const kindLabel = { purchase: 'purchase', sale: 'sale', production: 'production entry' } as const

/** Per-company queries worked out from entries; keyed [name, companyId, ...]. */
const COMPANY_KEYS = ['stock', 'summary', 'trends', 'oil-kpi', 'prices', 'production-report', 'wastage', 'debit-notes'] as const

/** Waits this long and refetches once, however many events arrive (e.g. a bulk approval). */
const BATCH_MS = 300

/**
 * Keeps every open screen current without refreshing: on each event, the affected lists,
 * stock and totals are refetched, and the people who need to act get a notice.
 */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient()
  const notify = useNotify()
  const user = useAppSelector((s) => s.auth.user)
  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    if (!enabled) return
    let client: RealtimeClient | null = null
    let unsubscribe = () => {}
    let cancelled = false
    // Distinct query keys to refetch, flushed together after BATCH_MS.
    const pending = new Map<string, QueryKey>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const invalidate = (...keys: QueryKey[]) => {
      keys.forEach((k) => pending.set(JSON.stringify(k), k))
      clearTimeout(timer)
      timer = setTimeout(() => {
        pending.forEach((k) => qc.invalidateQueries({ queryKey: k }))
        pending.clear()
      }, BATCH_MS)
    }

    const handle = (e: RealtimeEvent) => {
      const me = userRef.current
      if (e.type === 'ready') {
        // After a dropped connection, anything could have changed.
        if (e.reconnected) qc.invalidateQueries()
        return
      }
      if (e.type === 'access') {
        notify.info('Your access was changed', 'Please sign in again.')
        endSession()
        return
      }
      if (e.type === 'company') return invalidate(['auth', 'me'], ['companies'], ['stock', e.company_id], ['wastage', e.company_id])
      if (e.type === 'party') return invalidate(['parties', e.company_id])
      if (e.type === 'stock') return invalidate(['stock', e.company_id], ['stock-checks', e.company_id], ['wastage', e.company_id])
      if (e.type !== 'entry' || !me) return

      // Lists, stock, totals and every report built from entries in that company.
      invalidate(['entries'], ['status-summary'], ...COMPANY_KEYS.map((k) => [k, e.company_id]))
      if (e.actor_id === me.id) return
      const can = resolveAccess(me, null).can
      const what = `${kindLabel[e.entry_type!]} ${e.ref_no}`
      const mine = e.created_by_id === me.id
      if (e.alert === 'wastage_high' && (can('adjust_wastage', e.company_id) || can('view_oil_kpi', e.company_id))) {
        notify.alert(`High wastage on ${what}`, `Over the 2% limit (entered by ${e.actor_name}). A debit note is needed before it can be approved.`)
      } else if (e.alert === 'escalated' && (mine || can('approve_entry', e.company_id) || can('edit_entry', e.company_id))) {
        notify.warning(`${what} escalated to operations`, `${e.actor_name} (Finance) found a mismatch — open it to see the comment`)
      } else if (e.action === 'created' && e.status === 'pending' && can('approve_entry', e.company_id)) {
        notify.info(`New ${what}`, `From ${e.actor_name} — waiting for your approval`)
      } else if (e.action === 'created' && e.status === 'approved' && can('verify_entry', e.company_id)) {
        notify.info(`New ${what}`, `From ${e.actor_name} — waiting for your verification`)
      } else if (e.action === 'approved' && can('verify_entry', e.company_id)) {
        notify.info(`${what} approved`, `By ${e.actor_name} — waiting for your verification`)
      } else if (mine && ['held', 'rejected', 'verified', 'approved', 'commented', 'edited'].includes(e.action ?? '')) {
        const verb = { held: 'was put on hold', rejected: 'was rejected', verified: 'was verified', approved: 'was approved', commented: 'has a new comment', edited: 'was edited' }[e.action!]
        notify.info(`Your ${what} ${verb}`, `By ${e.actor_name}`)
      }
    }

    getRealtime().then((c) => {
      if (cancelled) return
      client = c
      unsubscribe = c.onEvent(handle)
      c.start()
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
      unsubscribe()
      client?.stop()
    }
  }, [enabled, qc, notify])
}

/** "live" / "connecting" / "offline", for the header indicator. */
export function useRealtimeStatus(): RealtimeStatus {
  const [client, setClient] = useState<RealtimeClient | null>(null)
  useEffect(() => {
    getRealtime().then(setClient)
  }, [])
  return useSyncExternalStore(
    (cb) => client?.subscribeStatus(cb) ?? (() => {}),
    () => client?.getStatus() ?? 'offline',
  )
}
