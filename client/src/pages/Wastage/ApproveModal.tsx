import { useState } from 'react'
import { Alert, Input, Modal } from 'antd'
import dayjs from 'dayjs'
import { itemName } from '../../data/catalog'
import { useApproveWastage } from '../../hooks/queries/wastage'
import { errorMessage } from '../../services/apiError'
import type { WastageMonth } from '../../types/reports'
import { formatKgFine } from '../../utils/format'

/** The Super Admin approves one month or several at once. Each month is sent with the figure
 *  shown here; if production changed since, the server refuses and nothing is approved. */
export default function ApproveModal({ companyId, months, onClose, onDone }: { companyId: number; months: WastageMonth[]; onClose: () => void; onDone?: () => void }) {
  const approve = useApproveWastage()
  const [comment, setComment] = useState('')
  const submit = () =>
    approve.mutate(
      { companyId, months: months.map((m) => ({ month: m.month, wastage_kg: m.wastage_kg })), comment: comment.trim() },
      {
        onSuccess: () => {
          setComment('')
          onDone?.()
          onClose()
        },
      },
    )

  return (
    <Modal
      open={months.length > 0}
      title={months.length === 1 ? `Approve ${dayjs(months[0].month).format('MMMM YYYY')} wastage` : `Approve ${months.length} months of wastage`}
      okText="Approve"
      onOk={submit}
      onCancel={onClose}
      confirmLoading={approve.isPending}
      destroyOnHidden
    >
      {approve.isError && <Alert type="error" showIcon title={errorMessage(approve.error)} style={{ marginBottom: 12 }} />}
      <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
        {months.map((m) => (
          <div key={m.month} className="summary-line" style={{ alignItems: 'flex-start' }}>
            <span className="strong">{dayjs(m.month).format('MMMM YYYY')}</span>
            <span className="num" style={{ textAlign: 'right' }}>
              <b>{formatKgFine(m.wastage_kg)}</b>
              {m.changed && (
                <div style={{ fontSize: 12.5, color: '#D98A0B' }}>
                  Changed from {formatKgFine(m.calculated_kg)} ·{' '}
                  {m.adjustments.map((a) => `${itemName(a.item)} ${a.qty > 0 ? '−' : '+'}${formatKgFine(Math.abs(a.qty))}`).join(', ')}
                </div>
              )}
            </span>
          </div>
        ))}
      </div>
      <Alert type="warning" showIcon style={{ marginBottom: 12 }} title="After approval, production for these months cannot be added, changed or rejected." />
      <Input.TextArea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={2000} placeholder="Comment (optional)" />
    </Modal>
  )
}
