import { useState } from 'react'
import { Alert, App, Button, Drawer, Input, Modal, Skeleton, Space } from 'antd'
import { CheckCircleOutlined, CheckOutlined, FileDoneOutlined, FlagOutlined, CloseOutlined, DeleteOutlined, EditOutlined, FileSearchOutlined, PauseOutlined, SafetyCertificateOutlined, WarningFilled } from '@ant-design/icons'
import { itemName } from '../../data/catalog'
import { gradeInfo } from '../../data/grades'
import { useDeleteEntry, useEntry, useEntryAction, useEscalation } from '../../hooks/queries/entries'
import { useAccess } from '../../hooks/useAccess'
import DebitNoteModal, { type NoteTarget } from '../wastage/DebitNoteModal'
import type { EntryAction, EntryDetail, EntryType } from '../../types/entries'
import { formatDate, formatINR, formatKg, formatKgFine, formatPercent, formatTonnes, formatQty, formatRateIn } from '../../utils/format'
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

/** Workflow actions plus Finance's escalation and the Admin's resolution. */
type Step = EntryAction | 'escalate' | 'resolve'

const actionMeta: Record<Step, { label: string; icon: React.ReactNode; primary?: boolean; danger?: boolean; needsComment: boolean; prompt: string }> = {
  approve: { label: 'Approve', icon: <CheckOutlined />, primary: true, needsComment: false, prompt: 'Approve and send to Finance?' },
  verify: { label: 'Verify', icon: <SafetyCertificateOutlined />, primary: true, needsComment: false, prompt: 'Verify? This finalises the stock.' },
  hold: { label: 'Put on hold', icon: <PauseOutlined />, needsComment: true, prompt: 'What is wrong? The team sees your comment.' },
  reject: { label: 'Reject', icon: <CloseOutlined />, danger: true, needsComment: true, prompt: 'Why is it rejected?' },
  escalate: { label: 'Escalate to operations', icon: <FlagOutlined />, needsComment: true, prompt: 'What does not match? The Admin, Managers and whoever entered it are told at once.' },
  resolve: { label: 'Resolve escalation', icon: <CheckCircleOutlined />, needsComment: true, prompt: 'What was found and done? This closes Finance’s escalation.' },
}
const STEPS: Step[] = ['approve', 'verify', 'hold', 'escalate', 'resolve', 'reject']

function Facts({ e }: { e: EntryDetail }) {
  const rows: [string, React.ReactNode][] = [
    ['Date', formatDate(e.entry_date)],
    ...(e.party_name ? ([[e.type === 'sale' ? 'Buyer' : 'Supplier', e.party_name]] as [string, string][]) : []),
    ...(e.invoice_no ? ([['Bill / invoice no.', e.invoice_no]] as [string, string][]) : []),
    ['Grade', <span key="g"><GradeTag grade={e.grade} type={e.type} /> {e.type === 'production' ? 'Production' : gradeInfo(e.grade)[e.type]}</span>],
    [e.type === 'production' ? 'Raw material' : 'Item', itemName(e.item)],
    [e.type === 'production' ? 'Taken from stock' : 'Quantity', e.unit === 'kg' ? `${formatKg(e.qty)} (${formatTonnes(e.qty)})` : formatQty(e.qty, e.unit)],
    ...(e.rate !== null ? ([['Rate', formatRateIn(e.rate, e.unit)]] as [string, string][]) : []),
    ...(e.shift ? ([['Shift', `Shift ${e.shift}`]] as [string, string][]) : []),
    ...(e.crew.length ? ([['Crew', e.crew.map((c) => c.name).join(', ')]] as [string, string][]) : []),
    ...(e.running_hours ? ([['Running hours', `${e.running_hours} h · ${formatPercent(e.efficiency_pct ?? 0, 0)} efficiency · ${(e.kg_per_hour ?? 0).toLocaleString('en-IN')} kg/h`]] as [string, string][]) : []),
    ['Entered by', `${e.created_by_name ?? '—'} · ${formatDate(e.created_at)}`],
    ...(e.approved_by_name ? ([['Approved by', `${e.approved_by_name} · ${formatDate(e.approved_at!)}`]] as [string, string][]) : []),
    ...(e.verified_by_name ? ([['Verified by', `${e.verified_by_name} · ${formatDate(e.verified_at!)}`]] as [string, string][]) : []),
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

function DebitNoteBlock({ e, onRecord }: { e: EntryDetail; onRecord?: () => void }) {
  if (!e.debit_note_required) return null
  const n = e.debit_note
  return n ? (
    <div className="surface" style={{ padding: '12px 14px', marginTop: 12, borderColor: '#cfe9dc', background: '#f6fbf8' }}>
      <div className="strong" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileDoneOutlined style={{ color: '#1F9D6B' }} /> Debit note {n.note_no}
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        {formatKg(n.qty_kg)} · {formatINR(n.amount)}
        {n.supplier_name ? ` · against ${n.supplier_name}` : ''} · by {n.created_by_name ?? '—'}, {formatDate(n.created_at)}
      </div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{n.reason}</div>
    </div>
  ) : (
    <div className="alert-strip danger" style={{ marginTop: 12 }}>
      <WarningFilled />
      <div style={{ flex: 1 }}>
        <b>Debit note needed.</b> More than 2% weight is missing. This entry cannot be approved until a debit note is added.
      </div>
      {onRecord && (
        <Button size="small" type="primary" danger onClick={onRecord}>
          Record debit note
        </Button>
      )}
    </div>
  )
}

function Production({ e, onRecordNote }: { e: EntryDetail; onRecordNote?: () => void }) {
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
        <DebitNoteBlock e={e} onRecord={onRecordNote} />
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
          description={e.debit_note_required ? 'Over the 2% limit: a high alert, and a debit note is required.' : 'Flagged as waste for the Admin to check before approving.'}
        />
      ) : (
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Missing {formatKg(e.wastage_kg ?? 0)} ({formatPercent(e.wastage_pct ?? 0)}) — within this month's {formatPercent(e.wastage_allowance_pct ?? 2)} allowance
        </div>
      )}
      <DebitNoteBlock e={e} onRecord={onRecordNote} />
    </div>
  )
}

/** One entry: its details, history and comments, and the workflow buttons this person may use. */
export default function EntryDrawer({ entryRef, onClose }: { entryRef: EntryRef | null; onClose: () => void }) {
  const { modal } = App.useApp()
  const entry = useEntry(entryRef)
  const act = useEntryAction()
  const escalation = useEscalation()
  const remove = useDeleteEntry()
  const { can } = useAccess()
  const [pending, setPending] = useState<Step | null>(null)
  const [noteFor, setNoteFor] = useState<NoteTarget | null>(null)
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)
  const [showBill, setShowBill] = useState(false)
  const e = entry.data

  const confirmAction = () => {
    if (!e || !pending) return
    const done = { onSuccess: () => setPending(null) }
    if (pending === 'escalate' || pending === 'resolve') escalation.mutate({ entry: e, step: pending, comment: comment.trim() }, done)
    else act.mutate({ entry: e, action: pending, comment: comment.trim() }, done)
  }

  const confirmDelete = (target: EntryDetail) => {
    let reason = ''
    modal.confirm({
      title: `Delete ${target.ref_no}?`,
      content: <Input placeholder="Reason (kept in the history)" onChange={(ev) => (reason = ev.target.value)} />,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => remove.mutateAsync({ entry: target, reason }).then(onClose),
    })
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
                  {actionMeta[a].label}
                </Button>
              ))}
            {e.actions.includes('edit') && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {e.actions.includes('delete') && (
              <Button danger type="text" icon={<DeleteOutlined />} onClick={() => confirmDelete(e)}>
                Delete
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
                <b>Escalated to operations</b> by Finance on {formatDate(e.escalated_at)}
                <div style={{ fontSize: 13 }}>{[...e.events].reverse().find((ev) => ev.action === 'escalated')?.comment}</div>
              </div>
            </div>
          )}
          {e.document_id && (
            <Button icon={<FileSearchOutlined />} style={{ marginTop: 12 }} onClick={() => setShowBill(true)}>
              Original bill
            </Button>
          )}
          <Facts e={e} />
          {e.type === 'production' && (
            <Production
              e={e}
              onRecordNote={
                can('adjust_wastage', e.company_id)
                  ? () => setNoteFor({ companyId: e.company_id, productionId: e.id, refNo: e.ref_no, wastageKg: e.wastage_kg ?? 0, wastagePct: e.wastage_pct ?? 0 })
                  : undefined
              }
            />
          )}
          <div className="strong" style={{ margin: '24px 0 12px' }}>
            History and comments
          </div>
          <EntryTimeline entry={e} />
        </>
      )}

      <Modal
        open={!!pending}
        title={pending && actionMeta[pending].label}
        okText={pending && actionMeta[pending].label}
        okButtonProps={{ danger: pending === 'reject', disabled: !!pending && actionMeta[pending].needsComment && !comment.trim() }}
        confirmLoading={act.isPending || escalation.isPending}
        onOk={confirmAction}
        onCancel={() => setPending(null)}
      >
        <p>{pending && actionMeta[pending].prompt}</p>
        <Input.TextArea
          value={comment}
          onChange={(ev) => setComment(ev.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={pending && actionMeta[pending].needsComment ? 'Required' : 'Comment (optional)'}
        />
      </Modal>
      {e && editing && <EntryEditModal entry={e} onClose={() => setEditing(false)} />}
      <DebitNoteModal target={noteFor} onClose={() => setNoteFor(null)} />
      {e?.document_id && showBill && <BillFileModal companyId={e.company_id} documentId={e.document_id} title={`Bill for ${e.ref_no}`} onClose={() => setShowBill(false)} />}
    </Drawer>
  )
}
