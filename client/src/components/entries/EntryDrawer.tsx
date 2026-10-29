import { useState } from 'react'
import { Alert, Button, Drawer, Input, Modal, Skeleton, Space } from 'antd'
import { CheckOutlined, FileExclamationOutlined, FlagOutlined, CloseOutlined, EditOutlined, FileSearchOutlined, SafetyCertificateOutlined, SendOutlined, WarningFilled } from '@ant-design/icons'
import { itemName } from '../../data/catalog'
import { gradeInfo } from '../../data/grades'
import { useEntry, useEntryAction, useEscalation } from '../../hooks/queries/entries'
import DebitNoteModal from '../debitNotes/DebitNoteModal'
import { DebitNoteGroup, OpenDebitNotes } from '../debitNotes/DebitNoteList'
import { useAdjustDebitNotes } from '../../hooks/queries/debitNotes'
import type { EntryAction, EntryDetail, EntryType } from '../../types/entries'
import { formatDate, formatINR, formatKg, formatKgFine, formatPercent, formatQty, formatRateIn } from '../../utils/format'
import { GradeTag, StatusTag } from '../ui'
import { statusMeta } from '../../utils/entryStatus'
import BillFileModal from '../bill/BillFileModal'
import EntryEditModal from './EntryEditModal'
import EntryTimeline from './EntryTimeline'

export interface EntryRef {
  companyId: number
  type: EntryType
  id: number
}

/** Workflow actions plus escalating back one step. */
type Step = EntryAction | 'escalate'

type StepMeta = { label: string; icon: React.ReactNode; primary?: boolean; danger?: boolean; needsComment: boolean; prompt: string }

const actionMeta: Record<Step, StepMeta> = {
  approve: { label: 'Approve', icon: <CheckOutlined />, primary: true, needsComment: false, prompt: 'Approve? It goes into stock and then to Finance.' },
  verify: { label: 'Approve', icon: <SafetyCertificateOutlined />, primary: true, needsComment: false, prompt: 'Give the final approval? After this the entry is final.' },
  escalate: { label: 'Escalate', icon: <FlagOutlined />, needsComment: true, prompt: 'What is wrong? You can talk in the comments after this.' },
  request_change: { label: 'Ask Super Admin to change', icon: <SendOutlined />, needsComment: true, prompt: 'What should be changed, and why? The Super Admin will change it or reject it.' },
  reject: { label: 'Reject', icon: <CloseOutlined />, danger: true, needsComment: true, prompt: 'Why is it rejected? This cannot be undone.' },
}
const STEPS: Step[] = ['approve', 'verify', 'escalate', 'request_change', 'reject']

/** The escalate button says who it goes back to: the in-charge (from the Manager) or the Manager (from Finance). */
function stepMeta(step: Step, e: EntryDetail): StepMeta {
  if (step !== 'escalate') return actionMeta[step]
  const to = e.status === 'pending' ? 'in-charge' : 'Manager'
  return { ...actionMeta.escalate, label: `Escalate to ${to}`, prompt: `What is wrong? The ${to} is told at once. You can talk in the comments. Approve when you agree.` }
}

function Facts({ e }: { e: EntryDetail }) {
  const rows: [string, React.ReactNode][] = [
    ['Date', formatDate(e.entry_date)],
    ...(e.party_name ? ([[e.type === 'sale' ? 'Buyer' : 'Supplier', e.party_name]] as [string, string][]) : []),
    ...(e.invoice_no ? ([['Bill / invoice no.', e.invoice_no]] as [string, string][]) : []),
    ...(e.vehicle_nos?.length ? ([['Vehicle numbers', e.vehicle_nos.join(', ')]] as [string, string][]) : []),
    ['Grade', <span key="g"><GradeTag grade={e.grade} type={e.type} /> {e.type === 'production' ? 'Production' : gradeInfo(e.grade)[e.type]}</span>],
    [e.type === 'production' ? 'Raw material' : 'Item', itemName(e.item)],
    [e.type === 'production' ? 'Taken from stock' : 'Quantity', formatQty(e.qty, e.unit)],
    ...(e.rate !== null ? ([['Rate', formatRateIn(e.rate, e.unit)]] as [string, string][]) : []),
    ...(e.shift ? ([['Shift', `Shift ${e.shift}`]] as [string, string][]) : []),
    ...(e.crew.length ? ([['Crew', e.crew.map((c) => c.name).join(', ')]] as [string, string][]) : []),
    ...(e.running_hours ? ([['Running hours', `${e.running_hours} h · ${formatPercent(e.efficiency_pct ?? 0, 0)} efficiency · ${(e.kg_per_hour ?? 0).toLocaleString('en-IN')} kg/h`]] as [string, string][]) : []),
    ['Entered by', `${e.created_by_name ?? '—'} · ${formatDate(e.created_at)}`],
    ...(e.approved_by_name ? ([['Approved by (Manager)', `${e.approved_by_name} · ${formatDate(e.approved_at!)}`]] as [string, string][]) : []),
    ...(e.verified_by_name ? ([['Final approval by', `${e.verified_by_name} · ${formatDate(e.verified_at!)}`]] as [string, string][]) : []),
    ...(e.notes ? ([['Notes', e.notes]] as [string, string][]) : []),
  ]
  return (
    <div style={{ background: '#f7f8fa', borderRadius: 12, padding: '4px 16px', marginTop: 16 }}>
      {rows.map(([k, v]) => (
        <div className="summary-line" key={k}>
          <span className="muted">{k}</span>
          <b className="num" style={{ textAlign: 'right' }}>
            {v}
          </b>
        </div>
      ))}
    </div>
  )
}

/** Purchases: debit notes raised on this bill, settled on it, and the supplier's other open notes. */
function PurchaseDebitNotes({ e, onRaise }: { e: EntryDetail; onRaise: () => void }) {
  const adjust = useAdjustDebitNotes()
  const [ticked, setTicked] = useState<number[]>([])
  const canAdjust = e.actions.includes('adjust_debit_note')
  return (
    <>
      <OpenDebitNotes
        notes={e.supplier_open_debit_notes}
        supplierName={e.party_name}
        selected={canAdjust ? ticked : undefined}
        onSelect={canAdjust ? setTicked : undefined}
        hint="If this bill settles a note, tick it and press Settled on this bill."
        footer={
          canAdjust && (
            <Button size="small" type="primary" style={{ marginTop: 8 }} disabled={!ticked.length} loading={adjust.isPending} onClick={() => adjust.mutate({ entry: e, noteIds: ticked }, { onSuccess: () => setTicked([]) })}>
              Settled on this bill
            </Button>
          )
        }
      />
      <DebitNoteGroup title="Debit notes settled on this bill" notes={e.adjusted_debit_notes} tone="done" />
      <DebitNoteGroup title={e.debit_notes.length === 1 ? 'Debit note on this bill' : 'Debit notes on this bill'} notes={e.debit_notes} tone="warn" />
      {e.actions.includes('debit_note') && (
        <Button icon={<FileExclamationOutlined />} style={{ marginTop: 12 }} onClick={onRaise}>
          Add debit note
        </Button>
      )}
    </>
  )
}

function Production({ e }: { e: EntryDetail }) {
  // Runs saved under the fixed 2% rule: stock went down by products + 2%.
  if (e.calculated_input_kg !== null) {
    const pct = e.wastage_pct ?? 2
    // Wastage is 2% of the products, or of a bigger total the in-charge typed (not saved).
    const wastageOn = ((e.wastage_kg ?? 0) * 100) / pct
    return (
      <div style={{ marginTop: 16 }}>
        <div className="strong" style={{ marginBottom: 8 }}>
          What came out
        </div>
        {e.outputs.map((o) => (
          <div className="summary-line" key={o.product}>
            <span>{itemName(o.product)}</span>
            <b className="num">
              {formatQty(o.qty, o.unit)}
              {o.unit !== 'kg' && <span className="faint"> · {formatKg(o.qty_kg)}</span>}
            </b>
          </div>
        ))}
        <div className="summary-line">
          <span className="muted">Products total</span>
          <b className="num">{formatKg(e.output_kg ?? 0)}</b>
        </div>
        <div className="summary-line">
          <span className="muted">
            Wastage ({formatPercent(pct, 0)} of {formatKgFine(wastageOn)})
          </span>
          <b className="num">{formatKgFine(e.wastage_kg ?? 0)}</b>
        </div>
        {!!e.returned_kg && (
          <>
            <div className="summary-line">
              <span className="muted">Raw material used (products + {formatPercent(pct, 0)})</span>
              <b className="num">{formatKg(e.calculated_input_kg)}</b>
            </div>
            <div className="summary-line">
              <span className="muted">Returned to stock</span>
              <b className="num">{formatKg(e.returned_kg)}</b>
            </div>
          </>
        )}
        <div className="summary-line">
          <span className="strong">Taken out of stock</span>
          <b className="num strong">{formatKg(e.calculated_input_kg - (e.returned_kg ?? 0))}</b>
        </div>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 16 }}>
      <div className="strong" style={{ marginBottom: 8 }}>
        What came out
      </div>
      {!!e.returned_kg && (
        <div className="summary-line">
          <span className="muted">Returned to stock unprocessed</span>
          <b className="num">{formatKg(e.returned_kg)}</b>
        </div>
      )}
      <div className="summary-line">
        <span className="muted">Processed</span>
        <b className="num">{formatKg(e.processed_kg ?? e.qty)}</b>
      </div>
      {e.outputs.map((o) => (
        <div className="summary-line" key={o.product}>
          <span>{itemName(o.product)}</span>
          <b className="num">
            {formatQty(o.qty, o.unit)}
            {o.unit !== 'kg' && <span className="faint"> · {formatKg(o.qty_kg)}</span>}
          </b>
        </div>
      ))}
      <div className="summary-line">
        <span className="muted">Total weight out</span>
        <b className="num">{formatKg(e.output_kg ?? 0)}</b>
      </div>
      {e.wastage_flagged ? (
        <Alert
          type="warning"
          showIcon
          icon={<WarningFilled />}
          style={{ marginTop: 10 }}
          title={`Missing ${formatKg(e.wastage_kg ?? 0)} (${formatPercent(e.wastage_pct ?? 0)}) — over this month's ${formatPercent(e.wastage_allowance_pct ?? 2)} allowance`}
          description="Flagged as waste for the Manager to check before approving."
        />
      ) : (
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Missing {formatKg(e.wastage_kg ?? 0)} ({formatPercent(e.wastage_pct ?? 0)}) — within this month's {formatPercent(e.wastage_allowance_pct ?? 2)} allowance
        </div>
      )}
    </div>
  )
}

/** One entry: its details, history and comments, and the workflow buttons this person may use. */
export default function EntryDrawer({ entryRef, onClose }: { entryRef: EntryRef | null; onClose: () => void }) {
  const entry = useEntry(entryRef)
  const act = useEntryAction()
  const escalation = useEscalation()
  const [pending, setPending] = useState<Step | null>(null)
  const [noteFor, setNoteFor] = useState<EntryDetail | null>(null)
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)
  const [showBill, setShowBill] = useState(false)
  const e = entry.data

  const confirmAction = () => {
    if (!e || !pending) return
    const done = { onSuccess: () => setPending(null) }
    if (pending === 'escalate') escalation.mutate({ entry: e, comment: comment.trim() }, done)
    else act.mutate({ entry: e, action: pending, comment: comment.trim() }, done)
  }

  return (
    <Drawer
      open={!!entryRef}
      onClose={onClose}
      size={600}
      title={e?.ref_no ?? 'Entry'}
      extra={e && <StatusTag status={e.status} />}
      destroyOnHidden
      footer={
        e && (
          <Space wrap>
            {STEPS.filter((a) => e.actions.includes(a))
              .map((a) => (
                <Button key={a} type={actionMeta[a].primary ? 'primary' : 'default'} danger={actionMeta[a].danger} icon={actionMeta[a].icon} onClick={() => {
                    setComment('')
                    setPending(a)
                  }}>
                  {stepMeta(a, e).label}
                </Button>
              ))}
            {e.actions.includes('edit') && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </Space>
        )
      }
    >
      {!e ? (
        <Skeleton active />
      ) : (
        <>
          {e.amount !== null && (
            <div className="num strong" style={{ fontSize: 28 }}>
              {formatINR(e.amount)}
            </div>
          )}
          <div className="muted">{statusMeta[e.status].hint}</div>
          {e.escalated_at && (
            <div className="alert-strip warn fade-in" style={{ marginTop: 12 }}>
              <FlagOutlined />
              <div>
                <b>{e.escalated_to === 'incharge' ? 'Manager sent it back to the in-charge' : 'Finance sent it back to the Manager'}</b> on {formatDate(e.escalated_at)}. Please reply in the comments below.
                <div style={{ fontSize: 13 }}>{[...e.events].reverse().find((ev) => ev.action === 'escalated')?.comment}</div>
              </div>
            </div>
          )}
          {e.type === 'purchase' && <PurchaseDebitNotes e={e} onRaise={() => setNoteFor(e)} />}
          {e.document_id && (
            <Button icon={<FileSearchOutlined />} style={{ marginTop: 12 }} onClick={() => setShowBill(true)}>
              Original bill
            </Button>
          )}
          <Facts e={e} />
          {e.type === 'production' && <Production e={e} />}
          <div className="strong" style={{ margin: '24px 0 12px' }}>
            History and comments
          </div>
          <EntryTimeline entry={e} />
        </>
      )}

      <Modal
        open={!!pending}
        title={pending && e && stepMeta(pending, e).label}
        okText={pending && e && stepMeta(pending, e).label}
        okButtonProps={{ danger: pending === 'reject', disabled: !!pending && actionMeta[pending].needsComment && !comment.trim() }}
        confirmLoading={act.isPending || escalation.isPending}
        onOk={confirmAction}
        onCancel={() => setPending(null)}
      >
        <p>{pending && e && stepMeta(pending, e).prompt}</p>
        <Input.TextArea
          value={comment}
          onChange={(ev) => setComment(ev.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={pending && actionMeta[pending].needsComment ? 'Required' : 'Comment (optional)'}
        />
      </Modal>
      {e && editing && <EntryEditModal entry={e} onClose={() => setEditing(false)} />}
      <DebitNoteModal purchase={noteFor} onClose={() => setNoteFor(null)} />
      {e?.document_id && showBill && <BillFileModal companyId={e.company_id} documentId={e.document_id} title={`Bill for ${e.ref_no}`} onClose={() => setShowBill(false)} />}
    </Drawer>
  )
}
