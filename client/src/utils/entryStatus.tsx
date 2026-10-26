import type { ReactNode } from 'react'
import { CheckCircleFilled, ClockCircleFilled, CloseCircleFilled, PauseCircleFilled, SafetyCertificateFilled } from '@ant-design/icons'
import type { EntryStatus } from '../types/entries'

/** How each workflow status is shown and explained. */
export const statusMeta: Record<EntryStatus, { label: string; color: string; icon: ReactNode; hint: string }> = {
  pending: { label: 'Waiting for Admin', color: 'warning', icon: <ClockCircleFilled />, hint: 'Saved. Waiting for the Admin to check.' },
  approved: { label: 'Waiting for Finance', color: 'processing', icon: <CheckCircleFilled />, hint: 'Admin has approved. Waiting for Finance to check.' },
  on_hold: { label: 'On hold', color: 'error', icon: <PauseCircleFilled />, hint: 'Finance found a problem. Please read the comments.' },
  verified: { label: 'Verified', color: 'success', icon: <SafetyCertificateFilled />, hint: 'Finance has checked it. This entry is final.' },
  rejected: { label: 'Rejected', color: 'default', icon: <CloseCircleFilled />, hint: 'Thrown out; does not count anywhere' },
}

