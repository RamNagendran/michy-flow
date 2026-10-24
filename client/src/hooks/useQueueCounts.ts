import { useMemo } from 'react'
import { useEntries } from './queries/entries'
import { usePendingNotes } from './queries/wastage'
import { useAccess } from './useAccess'

/**
 * What waits on this person, in the companies in view: pending entries for an Admin, approved
 * ones for Finance, anything on hold or escalated for everyone, and debit notes for whoever
 * manages wastage. Operators only count their own entries.
 */
export function useQueueCounts() {
  const { scope, can } = useAccess()
  const approver = useMemo(() => scope.filter((c) => can('approve_entry', c.id)).map((c) => c.id), [scope, can])
  const verifier = useMemo(() => scope.filter((c) => can('verify_entry', c.id)).map((c) => c.id), [scope, can])
  const wastage = useMemo(() => scope.filter((c) => can('adjust_wastage', c.id)).map((c) => c.id), [scope, can])
  const all = useMemo(() => scope.map((c) => c.id), [scope])
  const forAdmin = useEntries({ status: ['pending'], company_id: approver, page_size: 1 }, approver.length > 0)
  const forFinance = useEntries({ status: ['approved'], company_id: verifier, page_size: 1 }, verifier.length > 0)
  const onHold = useEntries({ status: ['on_hold'], company_id: all, page_size: 1 }, all.length > 0)
  const escalated = useEntries({ escalated: true, status: ['pending', 'approved', 'on_hold'], company_id: all, page_size: 1 }, all.length > 0)
  const notes = usePendingNotes(wastage)
  const counts = {
    admin: approver.length ? (forAdmin.data?.total ?? 0) : 0,
    finance: verifier.length ? (forFinance.data?.total ?? 0) : 0,
    hold: onHold.data?.total ?? 0,
    escalated: escalated.data?.total ?? 0,
    wastage: notes.total,
  }
  return { ...counts, total: counts.admin + counts.finance + counts.hold + counts.escalated + counts.wastage }
}
