import { useState } from 'react'
import { Alert, Button, Drawer, Input, InputNumber, Modal, Skeleton, Space, Table, Timeline } from 'antd'
import { CheckOutlined, EditOutlined, FlagOutlined, MessageOutlined, SendOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { itemName } from '../../data/catalog'
import { useChangeWastage, useWastageMonth, useWastageStep } from '../../hooks/queries/wastage'
import { errorMessage } from '../../services/apiError'
import type { StockShare, WastageEvent, WastageMonthDetail } from '../../types/reports'
import { formatKg, formatKgFine, formatPercent, kgInputProps } from '../../utils/format'
import ApproveModal from './ApproveModal'
import { statusMeta } from './wastageMeta'
import { WastageStatusTag } from './WastageStatusTag'

type Step = 'escalate' | 'resend' | 'comment'

const stepMeta: Record<Step, { label: string; prompt: string; icon: React.ReactNode }> = {
  escalate: { label: 'Ask the Manager', prompt: 'What should the Manager check? They reply and send it back to you.', icon: <FlagOutlined /> },
  resend: { label: 'Reply and send back', prompt: 'Write your answer. The month goes back to the Super Admin for approval.', icon: <SendOutlined /> },
  comment: { label: 'Comment', prompt: 'Add a comment to this month.', icon: <MessageOutlined /> },
}

const eventMeta: Record<WastageEvent['action'], { label: string; color: string }> = {
  sent: { label: 'Month ended. Sent to the Super Admin', color: '#2F6FEB' },
  escalated: { label: 'asked the Manager', color: '#D4380D' },
  resent: { label: 'replied and sent it back', color: '#7A5AF8' },
  commented: { label: 'commented', color: '#d98a0b' },
  changed: { label: 'changed the wastage', color: '#7A5AF8' },
  approved: { label: 'approved it', color: '#1f9d6b' },
}

function EventChanges({ e }: { e: WastageEvent }) {
  const c = e.changes
  if (!c) return null
  const kg = c.wastage_kg
  return (
    <div style={{ background: '#f7f8fa', borderRadius: 8, padding: '6px 10px', marginTop: 6, fontSize: 12.5 }}>
      {Array.isArray(kg) ? (
        <div>
          <b>Wastage:</b> <s className="faint">{formatKgFine(+kg[0])}</s> → {formatKgFine(+kg[1])}
        </div>
      ) : (
        kg && (
          <div>
            <b>Approved:</b> {formatKgFine(+kg)} <span className="faint">(production {formatKgFine(+(c.production_kg ?? 0))})</span>
          </div>
        )
      )}
      {c.stock_kg && (
        <div>
          <b>Stock:</b>{' '}
          {Object.entries(c.stock_kg)
            .map(([item, q]) => `${itemName(item)} ${+q > 0 ? '+' : '−'}${formatKgFine(Math.abs(+q))}`)
            .join(', ')}
        </div>
      )}
    </div>
  )
}

/** The raw stock a changed figure moves, per tyre type, before (and after) approval. */
function StockChanges({ m }: { m: WastageMonthDetail }) {
  const approved = m.status === 'approved'
  return (
    <div className="alert-strip warn fade-in" style={{ marginTop: 14, display: 'block' }}>
      <div className="strong" style={{ marginBottom: 8 }}>
        {approved ? 'Stock changed on approval' : 'Stock will change when approved'} · {m.wastage_kg > m.calculated_kg ? 'taken out' : 'put back'} by share of tyres used
      </div>
      <Table<StockShare>
        size="small"
        rowKey="item"
        pagination={false}
        dataSource={m.adjustments}
        columns={[
          { title: 'Tyre type', render: (_, a) => <b>{itemName(a.item)}</b> },
          { title: 'Used', align: 'right', render: (_, a) => <span className="num">{formatKg(a.processed_kg)} · {formatPercent(a.share_pct)}</span> },
          {
            title: 'Stock change',
            align: 'right',
            render: (_, a) => (
              <b className="num" style={{ color: a.qty > 0 ? '#D4380D' : '#1F9D6B' }}>
                {a.qty > 0 ? '−' : '+'}
                {formatKgFine(Math.abs(a.qty))}
              </b>
            ),
          },
          ...(approved
            ? []
            : [
                {
                  title: 'Stock now → after',
                  align: 'right' as const,
                  render: (_: unknown, a: StockShare) => (
                    <span className="num" style={{ color: (a.stock_after ?? 0) < 0 ? '#D4380D' : undefined }}>
                      {formatKg(a.stock_now ?? 0)} → <b>{formatKg(a.stock_after ?? 0)}</b>
                    </span>
                  ),
                },
              ]),
        ]}
      />
      {m.adjustments.some((a) => (a.stock_after ?? 0) < 0) && <div style={{ marginTop: 8, color: '#D4380D' }}>Not enough stock for this change. Approval will be refused.</div>}
    </div>
  )
}

/** One month's wastage: the figures, the stock a change moves, the history, and the buttons. */
export default function MonthDrawer({ companyId, month, onClose }: { companyId: number; month: string | null; onClose: () => void }) {
  const detail = useWastageMonth(companyId, month)
  const step = useWastageStep()
  const change = useChangeWastage()
  const [pending, setPending] = useState<Step | null>(null)
  const [comment, setComment] = useState('')
  const [changing, setChanging] = useState(false)
  const [newKg, setNewKg] = useState<number | null>(null)
  const [approving, setApproving] = useState(false)
  const m = detail.data
  const can = (a: string) => !!m?.actions.includes(a as never)

  const open = (s: Step) => {
    setComment('')
    setPending(s)
  }
  const sendStep = () => m && pending && step.mutate({ companyId, month: m.month, action: pending, comment: comment.trim() }, { onSuccess: () => setPending(null) })
  const saveChange = () =>
    m && newKg !== null && change.mutate({ companyId, month: m.month, body: { wastage_kg: newKg, comment: comment.trim() } }, { onSuccess: () => setChanging(false) })
  const lastQuestion = m && [...m.events].reverse().find((e) => e.action === 'escalated')

  return (
    <Drawer
      open={!!month}
      onClose={onClose}
      size={620}
      title={month ? `${dayjs(month).format('MMMM YYYY')} wastage` : 'Wastage'}
      extra={m && <WastageStatusTag status={m.status} />}
      destroyOnHidden
      footer={
        m &&
        m.actions.length > 0 && (
          <Space wrap>
            {can('approve') && (
              <Button type="primary" icon={<CheckOutlined />} onClick={() => setApproving(true)}>
                Approve
              </Button>
            )}
            {can('change') && (
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  setNewKg(m.wastage_kg)
                  setComment('')
                  setChanging(true)
                }}
              >
                Change wastage
              </Button>
            )}
            {(['escalate', 'resend', 'comment'] as const)
              .filter((s) => can(s))
              .map((s) => (
                <Button key={s} type={s === 'resend' ? 'primary' : 'default'} icon={stepMeta[s].icon} onClick={() => open(s)}>
                  {stepMeta[s].label}
                </Button>
              ))}
          </Space>
        )
      }
    >
      {detail.isError ? (
        <Alert type="error" showIcon title={errorMessage(detail.error)} />
      ) : !m ? (
        <Skeleton active />
      ) : (
        <>
          <div className="num strong" style={{ fontSize: 28 }}>
            {formatKgFine(m.wastage_kg)} <span className="muted" style={{ fontSize: 15 }}>· {formatPercent(m.wastage_pct, 2)}</span>
          </div>
          <div className="muted">{statusMeta[m.status].hint}</div>
          {m.status === 'escalated' && lastQuestion && (
            <div className="alert-strip warn fade-in" style={{ marginTop: 12 }}>
              <FlagOutlined />
              <div>
                <b>{lastQuestion.actor_name} asked the Manager</b>
                <div style={{ fontSize: 13 }}>{lastQuestion.comment}</div>
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gap: 2, marginTop: 14 }}>
            {[
              ['Production runs', m.runs],
              ['Processed', formatKg(m.processed_kg)],
              ['Total weight out', formatKg(m.output_kg)],
              ['Wastage from production (2%)', formatKgFine(m.calculated_kg)],
              ...(m.changed ? [['Changed by the Super Admin to', formatKgFine(m.wastage_kg)]] : []),
              ...(m.approved_at ? [['Approved', `${m.approved_by_name ?? '—'} · ${dayjs(m.approved_at).format('DD MMM YYYY')}`]] : []),
            ].map(([k, v]) => (
              <div key={k as string} className="summary-line">
                <span className="muted">{k}</span>
                <b className="num">{v}</b>
              </div>
            ))}
          </div>
          {m.adjustments.length > 0 && <StockChanges m={m} />}
          <div className="strong" style={{ margin: '24px 0 12px' }}>
            History and comments
          </div>
          <Timeline
            items={m.events.map((e) => ({
              color: eventMeta[e.action].color,
              content: (
                <div>
                  <div>
                    {e.actor_name && <b>{e.actor_name} </b>}
                    {eventMeta[e.action].label}
                    <span className="faint" style={{ fontSize: 12 }}>
                      {' '}
                      · {dayjs(e.created_at).format('DD MMM YYYY, h:mm A')}
                    </span>
                  </div>
                  {e.comment && <div style={{ marginTop: 2 }}>{e.comment}</div>}
                  <EventChanges e={e} />
                </div>
              ),
            }))}
          />
        </>
      )}

      <Modal
        open={!!pending}
        title={pending && stepMeta[pending].label}
        okText={pending && stepMeta[pending].label}
        okButtonProps={{ disabled: !comment.trim() }}
        confirmLoading={step.isPending}
        onOk={sendStep}
        onCancel={() => setPending(null)}
        destroyOnHidden
      >
        {step.isError && <Alert type="error" showIcon title={errorMessage(step.error)} style={{ marginBottom: 12 }} />}
        <p>{pending && stepMeta[pending].prompt}</p>
        <Input.TextArea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} placeholder="Required" />
      </Modal>

      <Modal
        open={changing}
        title="Change this month's wastage"
        okText="Save change"
        okButtonProps={{ disabled: newKg === null || !comment.trim() || newKg === m?.wastage_kg }}
        confirmLoading={change.isPending}
        onOk={saveChange}
        onCancel={() => setChanging(false)}
        destroyOnHidden
      >
        {change.isError && <Alert type="error" showIcon title={errorMessage(change.error)} style={{ marginBottom: 12 }} />}
        <p className="muted">
          Production shows {m ? formatKgFine(m.calculated_kg) : '—'}. The difference is taken out of (or put back into) raw stock by share of tyres used, only when you approve.
        </p>
        <InputNumber<number> style={{ width: '100%', marginBottom: 12 }} value={newKg} onChange={setNewKg} precision={3} {...kgInputProps} />
        <Input.TextArea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={2000} placeholder="Reason (required)" />
      </Modal>

      {m && <ApproveModal companyId={companyId} months={approving ? [m] : []} onClose={() => setApproving(false)} />}
    </Drawer>
  )
}
