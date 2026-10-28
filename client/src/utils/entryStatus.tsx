import type { ReactNode } from 'react'
import { CheckCircleFilled, ClockCircleFilled, CloseCircleFilled, EditFilled, SafetyCertificateFilled } from '@ant-design/icons'
import type { EntryStatus } from '../types/entries'

/** How each workflow status is shown and explained. */
export const statusMeta: Record<EntryStatus, { label: string; color: string; icon: ReactNode; hint: string }> = {
  pending: { label: 'Waiting for Manager', color: 'warning', icon: <ClockCircleFilled />, hint: 'Saved. Waiting for the Manager to check. Not in stock yet.' },
  approved: { label: 'Waiting for Finance', color: 'processing', icon: <CheckCircleFilled />, hint: 'Manager has approved. It is in stock now. Waiting for Finance to check.' },
  change_requested: { label: 'With Super Admin', color: 'error', icon: <EditFilled />, hint: 'The Manager asked the Super Admin to change or reject it.' },
  verified: { label: 'Final', color: 'success', icon: <SafetyCertificateFilled />, hint: 'Finance has approved it. This entry is final.' },
  rejected: { label: 'Rejected', color: 'default', icon: <CloseCircleFilled />, hint: 'Rejected by the Super Admin. It does not count anywhere.' },
}
