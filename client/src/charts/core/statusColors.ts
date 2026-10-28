import type { EntryStatus } from '../../types/entries'

/**
 * Entry states in the reserved status palette (never reused for ordinary series). Every chart
 * that uses them also shows the status name, so colour never carries the meaning alone.
 */
export const statusColor: Record<EntryStatus, string> = {
  pending: '#fab219',
  approved: '#2a78d6',
  change_requested: '#d03b3b',
  verified: '#0ca30c',
  rejected: '#a1a1aa',
}

export const STATUS_ORDER: EntryStatus[] = ['pending', 'approved', 'change_requested', 'verified', 'rejected']
