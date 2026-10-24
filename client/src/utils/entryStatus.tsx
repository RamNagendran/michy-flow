import type { ReactNode } from 'react'
import { CheckCircleFilled, ClockCircleFilled, CloseCircleFilled, PauseCircleFilled, SafetyCertificateFilled } from '@ant-design/icons'
import type { EntryStatus } from '../types/entries'

/** How each workflow status is shown and explained. */
export const statusMeta: Record<EntryStatus, { label: string; color: string; icon: ReactNode; hint: string }> = {
  pending: { label: 'Waiting for Admin', color: 'warning', icon: <ClockCircleFilled />, hint: 'Entered; the company Admin has to check it' },
  approved: { label: 'Waiting for Finance', color: 'processing', icon: <CheckCircleFilled />, hint: 'Admin approved; Finance has to verify it' },
  on_hold: { label: 'On hold', color: 'error', icon: <PauseCircleFilled />, hint: 'Finance found a problem — see the comments' },
  verified: { label: 'Verified', color: 'success', icon: <SafetyCertificateFilled />, hint: 'Finance verified it: final, and in the finalised stock' },
  rejected: { label: 'Rejected', color: 'default', icon: <CloseCircleFilled />, hint: 'Thrown out; does not count anywhere' },
}

