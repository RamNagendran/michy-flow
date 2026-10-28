import { Alert, Form, Input, InputNumber, Modal } from 'antd'
import { itemName } from '../../data/catalog'
import { useRaiseDebitNote } from '../../hooks/queries/debitNotes'
import { errorMessage } from '../../services/apiError'
import type { DebitNoteInput, EntryDetail } from '../../types/entries'
import { formatQty, qtyInputProps } from '../../utils/format'
import { requiredMark } from '../../utils/formMarks'

/** Flag an issue with this purchase. Everyone sees it on the supplier's next purchases; it changes nothing by itself. */
export default function DebitNoteModal({ purchase, onClose }: { purchase: EntryDetail | null; onClose: () => void }) {
  const [form] = Form.useForm<DebitNoteInput>()
  const save = useRaiseDebitNote()
  const unit = purchase?.unit ?? 'kg'
  const submit = (v: DebitNoteInput) =>
    save.mutate(
      { companyId: purchase!.company_id, purchaseId: purchase!.id, body: { note_no: (v.note_no ?? '').trim(), reason: v.reason.trim(), qty: v.qty ?? null, amount: v.amount ?? null } },
      { onSuccess: onClose },
    )
  return (
    <Modal open={!!purchase} title={`Debit note on ${purchase?.ref_no ?? ''}`} okText="Save debit note" onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending} destroyOnHidden>
      {purchase && (
        <div className="muted" style={{ marginBottom: 16 }}>
          {purchase.party_name} · bill {purchase.invoice_no} · {formatQty(purchase.qty, unit)} {itemName(purchase.item)}. Everyone will see this note on the next purchase from {purchase.party_name}, and while approving it. It does not change stock or amounts.
        </div>
      )}
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      <Form<DebitNoteInput> form={form} layout="vertical" requiredMark={requiredMark} onFinish={submit} preserve={false}>
        <Form.Item label="What happened?" name="reason" rules={[{ required: true, whitespace: true, max: 2000, message: 'Write what happened' }]}>
          <Input.TextArea rows={3} maxLength={2000} autoFocus placeholder="e.g. 150 kg was wet and could not be used. Take ₹2,175 off the next bill." />
        </Form.Item>
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
          <Form.Item label="Quantity" name="qty" rules={[{ type: 'number', min: 0.001, max: purchase?.qty, message: `Enter up to ${formatQty(purchase?.qty ?? 0, unit)}` }]}>
            <InputNumber<number> style={{ width: '100%' }} placeholder="If needed" {...qtyInputProps(unit)} />
          </Form.Item>
          <Form.Item label="Amount" name="amount" rules={[{ type: 'number', min: 0 }]}>
            <InputNumber<number> style={{ width: '100%' }} prefix="₹" min={0} precision={2} placeholder="If needed" />
          </Form.Item>
        </div>
        <Form.Item label="Debit note number" name="note_no" rules={[{ max: 50 }]} extra="Leave blank to get the next number.">
          <Input placeholder="e.g. DN/26-27/014" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
