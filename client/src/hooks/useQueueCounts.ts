import { useMemo } from 'react'
import { useEntries } from './queries/entries'
import { useWastageQueue } from './queries/wastage'
import { useAccess } from './useAccess'

/**
 * What waits on this person, in the companies in view:
 * - Manager: new entries to approve, and entries Finance sent back.
 * - Finance: entries the Manager approved.
 * - Super Admin: change requests from the Manager.
 * - In-charge: their own entries the Manager sent back (the server returns only their own).
 * - Monthly wastage: the Super Admin approves ended months; the Manager answers escalations.
 * `entries` counts the Approvals screen, `wastage` the Wastage screen, `total` both (the bell).
 */
export function useQueueCounts() {
  const { scope, can } = useAccess()
  const { manager, finance, superAdmin, incharge } = useMemo(() => {
    const where = (p: Parameters<typeof can>[0]) => scope.filter((c) => can(p, c.id)).map((c) => c.id)
    return {
      manager: where('approve_entry'),
      finance: where('verify_entry'),
      superAdmin: where('edit_entry'),
      // In-charges: anyone who enters but cannot see everyone's entries.
      incharge: scope
        .filter((c) => !can('view_all_entries', c.id) && (can('enter_purchase', c.id) || can('enter_sales', c.id) || can('enter_production', c.id)))
        .map((c) => c.id),
    }
  }, [scope, can])
  const toApprove = useEntries({ status: ['pending'], escalated: false, company_id: manager, page_size: 1 }, manager.length > 0)
  const fromFinance = useEntries({ escalated_to: 'manager', company_id: manager, page_size: 1 }, manager.length > 0)
  const toVerify = useEntries({ status: ['approved'], escalated: false, company_id: finance, page_size: 1 }, finance.length > 0)
  const changes = useEntries({ status: ['change_requested'], company_id: superAdmin, page_size: 1 }, superAdmin.length > 0)
  const toIncharge = useEntries({ escalated_to: 'incharge', company_id: incharge, page_size: 1 }, incharge.length > 0)
  const talksWastage = scope.some((c) => can('approve_wastage', c.id) || can('adjust_wastage', c.id))
  const wastageQueue = useWastageQueue(talksWastage)
  const n = (on: number[], q: { data?: { total: number } }) => (on.length ? (q.data?.total ?? 0) : 0)
  const inScope = new Set(scope.map((c) => c.id))
  const wastageRows = (talksWastage ? (wastageQueue.data ?? []) : []).filter((r) => inScope.has(r.company_id))
  const wastageToApprove = wastageRows.reduce((a, r) => a + r.to_approve, 0)
  const wastageEscalated = wastageRows.reduce((a, r) => a + r.escalated, 0)
  const counts = {
    manager: n(manager, toApprove),
    fromFinance: n(manager, fromFinance),
    finance: n(finance, toVerify),
    changes: n(superAdmin, changes),
    toIncharge: n(incharge, toIncharge),
  }
  const entries = Object.values(counts).reduce((a, b) => a + b, 0)
  const wastage = wastageToApprove + wastageEscalated
  return { ...counts, wastageToApprove, wastageEscalated, entries, wastage, total: entries + wastage }
}
