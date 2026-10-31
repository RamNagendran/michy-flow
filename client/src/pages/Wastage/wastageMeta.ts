import type { WastageMonth, WastageStatus } from '../../types/reports'

export const statusMeta: Record<WastageStatus, { label: string; color: string; hint: string }> = {
  open: { label: 'Running', color: 'default', hint: 'This month is still running. It goes to the Super Admin when it ends.' },
  pending: { label: 'With Super Admin', color: 'processing', hint: 'Waiting for the Super Admin to approve.' },
  escalated: { label: 'With Manager', color: 'warning', hint: 'The Super Admin has a question. The Manager should reply and send it back.' },
  approved: { label: 'Approved', color: 'success', hint: 'Final. Production for this month is locked.' },
}

/** Months the Super Admin can approve now. */
export const approvable = (m: WastageMonth) => m.status === 'pending' || m.status === 'escalated'
