import dayjs from 'dayjs'
import { itemName } from '../../data/catalog'
import type { AuditArea } from '../../hooks/queries/audit'
import type { AuditLog } from '../../types/auth'

export const AREAS: { value: AuditArea; label: string }[] = [
  { value: 'entries', label: 'Purchases, production & sales' },
  { value: 'wastage', label: 'Wastage & stock checks' },
  { value: 'parties', label: 'Suppliers & buyers' },
  { value: 'documents', label: 'Bills uploaded' },
  { value: 'people', label: 'People & access' },
  { value: 'sign_in', label: 'Sign-in & passwords' },
  { value: 'companies', label: 'Companies' },
  { value: 'items', label: 'Items & company types' },
]

type Tone = 'success' | 'processing' | 'warning' | 'error' | 'purple' | undefined

const ACTIONS: Record<string, [string, Tone]> = {
  signup: ['Organisation created', 'purple'],
  login: ['Signed in', undefined],
  login_failed: ['Wrong password tried', 'error'],
  password_changed: ['Changed own password', undefined],
  password_reset: ['Password reset', 'warning'],
  user_created: ['Person added', 'success'],
  user_updated: ['Person edited', 'processing'],
  user_access_changed: ['Access changed', 'warning'],
  operator_created: ['Operator added', 'success'],
  company_created: ['Company added', 'success'],
  company_updated: ['Company edited', 'processing'],
  company_configured: ['Company settings changed', 'processing'],
  party_created: ['Supplier / buyer added', 'success'],
  party_updated: ['Supplier / buyer edited', 'processing'],
  item_created: ['Item added', 'success'],
  item_updated: ['Item edited', 'processing'],
  item_deleted: ['Item deleted', 'error'],
  company_type_created: ['Company type added', 'success'],
  company_type_updated: ['Company type edited', 'processing'],
  company_type_deleted: ['Company type deleted', 'error'],
  document_uploaded: ['Bill uploaded', undefined],
  bill_gstin_corrected: ['GST number on bill corrected', 'warning'],
  stock_counted: ['Physical stock counted', 'purple'],
  'entry.created': ['Entry created', 'success'],
  'entry.edited': ['Entry edited', 'processing'],
  'entry.approved': ['Approved by Manager', 'success'],
  'entry.verified': ['Final approval by Finance', 'success'],
  'entry.change_requested': ['Change asked', 'warning'],
  'entry.rejected': ['Entry rejected', 'error'],
  'entry.escalated': ['Escalated', 'warning'],
  'entry.commented': ['Comment added', undefined],
  'entry.gstin_corrected': ['GST number corrected', 'warning'],
  'entry.debit_note': ['Debit note raised', 'warning'],
  'entry.debit_note_adjusted': ['Debit note settled', 'processing'],
  'entry.debit_note_reopened': ['Debit note opened again', 'warning'],
  'wastage.changed': ['Wastage changed', 'processing'],
  'wastage.approved': ['Wastage approved', 'success'],
  'wastage.escalated': ['Wastage escalated', 'warning'],
  'wastage.resent': ['Wastage sent back', undefined],
  'wastage.commented': ['Wastage comment', undefined],
}

export const actionText = (action: string): [string, Tone] => ACTIONS[action] ?? [action.replace(/[._]/g, ' '), undefined]

const KIND: Record<string, string> = { purchase: 'Purchase', sale: 'Sale', production: 'Production' }
export const isEntry = (log: AuditLog) => log.entity_type in KIND && !!log.company_id && !!log.entity_id

/** What the row is about, in a few words: entry no., person, month, file… */
export function recordText(log: AuditLog): string {
  const d = log.details
  const str = (k: string) => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : null)
  if (str('ref_no')) return `${KIND[log.entity_type] ?? ''} ${str('ref_no')}`.trim()
  if (str('month')) return dayjs(str('month')).format('MMMM YYYY')
  if (str('counted_on')) return `Count on ${dayjs(str('counted_on')).format('DD MMM YYYY')}`
  return str('name') ?? str('full_name') ?? str('email') ?? str('filename') ?? str('key') ?? '—'
}

// Keys already shown in the "On" column, or not useful to read.
const HIDDEN = new Set(['ref_no', 'month', 'counted_on', 'changes', 'differences', 'comment', 'status', 'document_id'])

export const fieldName = (k: string) => {
  const s = k.replace(/_id$/, '').replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return 'empty'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(show).join(', ') || 'none'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Old → new pairs. Older rows saved only the new value; those show without the arrow. */
export function changeRows(log: AuditLog): { field: string; from?: string; to: string }[] {
  const d = log.details
  const rows: { field: string; from?: string; to: string }[] = []
  const changes = (d.changes ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(changes)) {
    const pair = Array.isArray(v) && v.length === 2 && log.action !== 'party_created'
    rows.push(pair ? { field: fieldName(k), from: show(v[0]), to: show(v[1]) } : { field: fieldName(k), to: show(v) })
  }
  const diffs = (d.differences ?? {}) as Record<string, [string, string]>
  for (const [item, [book, counted]] of Object.entries(diffs)) rows.push({ field: itemName(item), from: `${book} in books`, to: `${counted} counted` })
  return rows
}

export function otherFacts(log: AuditLog): [string, string][] {
  return Object.entries(log.details)
    .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => [fieldName(k), show(v)])
}
