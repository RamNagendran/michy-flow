import { Alert, Form, Input, InputNumber, Modal, Select } from 'antd'
import { useParties } from '../../hooks/queries/parties'
import { useAddDebitNote } from '../../hooks/queries/wastage'
import { errorMessage } from '../../services/apiError'
import type { DebitNoteInput } from '../../types/reports'
import { formatKg, formatPercent, kgInputProps } from '../../utils/format'
import { requiredMark } from '../../utils/formMarks'

export interface NoteTarget {
  companyId: number
  productionId: number
  refNo: string
  wastageKg: number
  wastagePct: number
}

/** Record the debit note a run over the hard wastage limit needs before it can be approved. */
export default function DebitNoteModal({ target, onClose }: { target: NoteTarget | null; onClose: () => void }) {
  const [form] = Form.useForm<DebitNoteInput>()
  const suppliers = useParties(target?.companyId, 'supplier')
  const save = useAddDebitNote()
  const submit = (v: DebitNoteInput) => save.mutate({ companyId: target!.companyId, productionId: target!.productionId, body: { ...v, note_no: v.note_no.trim(), reason: v.reason.trim() } }, { onSuccess: onClose })
  return (
    <Modal open={!!target} title={`Debit note for ${target?.refNo ?? ''}`} okText="Record debit note" onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending} destroyOnHidden>
      {target && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={`${formatKg(target.wastageKg)} missing (${formatPercent(target.wastagePct, 2)}) — over the 2% limit`}
          description="After you save this note, the production entry can be approved."
        />
      )}
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      <Form<DebitNoteInput> form={form} layout="vertical" requiredMark={requiredMark} onFinish={submit} initialValues={{ qty_kg: target?.wastageKg, amount: 0 }} preserve={false}>
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
          <Form.Item label="Debit note number" name="note_no" rules={[{ required: true, whitespace: true, max: 50 }]}>
            <Input placeholder="e.g. DN/26-27/014" />
          </Form.Item>
          <Form.Item label="Supplier" name="supplier_id">
            <Select allowClear showSearch={{ optionFilterProp: 'label' }} loading={suppliers.isLoading} options={suppliers.data?.map((p) => ({ value: p.id, label: p.name }))} placeholder="Who it is raised against" />
          </Form.Item>
          <Form.Item label="Quantity" name="qty_kg" rules={[{ required: true, type: 'number', min: 0.001 }]}>
            <InputNumber<number> style={{ width: '100%' }} {...kgInputProps} />
          </Form.Item>
          <Form.Item label="Amount" name="amount" rules={[{ required: true, type: 'number', min: 0 }]}>
            <InputNumber<number> style={{ width: '100%' }} prefix="₹" min={0} precision={2} />
          </Form.Item>
        </div>
        <Form.Item label="Reason" name="reason" rules={[{ required: true, whitespace: true, max: 2000, message: 'Say why the wastage was high' }]}>
          <Input.TextArea rows={3} maxLength={2000} placeholder="e.g. Wet and mud-filled tyres in the 12 Oct load" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
