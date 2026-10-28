import { Checkbox } from 'antd'
import { CheckCircleFilled, WarningFilled } from '@ant-design/icons'
import { itemName } from '../../data/catalog'
import { useOpenDebitNotes } from '../../hooks/queries/debitNotes'
import type { DebitNote } from '../../types/entries'
import { formatDate, formatINR, formatQty } from '../../utils/format'

function NoteLine({ n, check }: { n: DebitNote; check?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
      {check}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="strong" style={{ whiteSpace: 'pre-wrap' }}>{n.reason}</div>
        {(n.qty !== null || n.amount !== null) && (
          <div className="num" style={{ fontSize: 13 }}>
            {[n.qty !== null && `${formatQty(n.qty, n.unit)}${n.item ? ` ${itemName(n.item)}` : ''}`, n.amount !== null && formatINR(n.amount)].filter(Boolean).join(' · ')}
          </div>
        )}
        <div className="muted" style={{ fontSize: 12.5 }}>
          {n.note_no} · on {n.purchase_ref_no} (bill {n.invoice_no}, {formatDate(n.purchase_date)}) · added by {n.created_by_name ?? '—'}
          {n.adjusted_ref_no && ` · settled on ${n.adjusted_ref_no} by ${n.adjusted_by_name ?? '—'}, ${formatDate(n.adjusted_at!)}`}
        </div>
      </div>
    </div>
  )
}

/**
 * A supplier's open debit notes: issues from earlier purchases the team should know about.
 * With `selected`, each one has a "settled on this bill" tick.
 */
export function OpenDebitNotes({ notes, supplierName, selected, onSelect, hint = 'If this bill settles a note, tick it.', footer }: { notes: DebitNote[]; supplierName?: string | null; selected?: number[]; onSelect?: (ids: number[]) => void; hint?: string; footer?: React.ReactNode }) {
  if (!notes.length) return null
  const who = supplierName ?? notes[0].supplier_name ?? 'This supplier'
  return (
    <div className="alert-strip warn fade-in" style={{ display: 'block', marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <WarningFilled />
        <b>
          {who} has {notes.length === 1 ? 'a debit note' : `${notes.length} debit notes`} open
        </b>
      </div>
      <div style={{ fontSize: 13, marginBottom: 4 }}>Issues from earlier purchases. Please read before you go ahead.</div>
      {notes.map((n) => (
        <NoteLine
          key={n.id}
          n={n}
          check={
            onSelect ? (
              <Checkbox style={{ marginTop: 2 }}
                checked={selected?.includes(n.id)}
                onChange={(ev) => onSelect(ev.target.checked ? [...(selected ?? []), n.id] : (selected ?? []).filter((id) => id !== n.id))}
                aria-label={`${n.note_no} is settled on this bill`}
              />
            ) : undefined
          }
        />
      ))}
      {onSelect && <div style={{ fontSize: 13, marginTop: 4 }}>{hint}</div>}
      {footer}
    </div>
  )
}

/** Debit notes raised on this bill, or settled on it. */
export function DebitNoteGroup({ title, notes, tone }: { title: string; notes: DebitNote[]; tone: 'warn' | 'done' }) {
  if (!notes.length) return null
  return (
    <div className="surface" style={{ padding: '10px 14px', marginTop: 12, ...(tone === 'done' ? { borderColor: '#cfe9dc', background: '#f6fbf8' } : { borderColor: '#ffe0a8', background: '#fffaf0' }) }}>
      <div className="strong" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        {tone === 'done' ? <CheckCircleFilled style={{ color: '#1F9D6B' }} /> : <WarningFilled style={{ color: '#d98a0b' }} />} {title}
      </div>
      {notes.map((n) => (
        <NoteLine key={n.id} n={n} />
      ))}
    </div>
  )
}

/** While entering a purchase: the chosen supplier's open debit notes, to tick off. */
export default function SupplierDebitNotes({ companyId, supplierId, supplierName, selected, onSelect }: { companyId?: number; supplierId?: number; supplierName?: string | null; selected: number[]; onSelect: (ids: number[]) => void }) {
  const notes = useOpenDebitNotes(companyId, supplierId)
  return <OpenDebitNotes notes={notes.data ?? []} supplierName={supplierName} selected={selected} onSelect={onSelect} />
}
