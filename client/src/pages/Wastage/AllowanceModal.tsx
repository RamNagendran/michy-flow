import { Alert, DatePicker, Form, Input, InputNumber, Modal } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { WASTAGE_ALERT_PCT } from '../../data/catalog'
import { useDeclareAllowance } from '../../hooks/queries/wastage'
import { errorMessage } from '../../services/apiError'
import { requiredMark } from '../../utils/formMarks'

interface Values {
  month: Dayjs
  pct: number
  note: string
}

/** The Admin declares the wastage % acceptable for a month (up to the 2% limit). */
export default function AllowanceModal({ companyId, open, current, onClose }: { companyId: number; open: boolean; current?: number; onClose: () => void }) {
  const [form] = Form.useForm<Values>()
  const save = useDeclareAllowance()
  const submit = (v: Values) => save.mutate({ companyId, body: { month: v.month.startOf('month').format('YYYY-MM-DD'), pct: v.pct, note: v.note?.trim() ?? '' } }, { onSuccess: onClose })
  return (
    <Modal open={open} title="Declare the monthly wastage allowance" okText="Save allowance" onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending} destroyOnHidden>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={`Enter between 0.1% and ${WASTAGE_ALERT_PCT}% of the weight processed`}
        description={`Entries above this are marked for checking. Above ${WASTAGE_ALERT_PCT}% always needs a debit note.`}
      />
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      <Form<Values> form={form} layout="vertical" requiredMark={requiredMark} onFinish={submit} initialValues={{ month: dayjs(), pct: current ?? 1.5, note: '' }} preserve={false}>
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
          <Form.Item label="Month" name="month" rules={[{ required: true }]}>
            <DatePicker picker="month" format="MMMM YYYY" style={{ width: '100%' }} allowClear={false} disabledDate={(d) => d.isAfter(dayjs().add(1, 'month'), 'month')} />
          </Form.Item>
          <Form.Item label="Allowed wastage" name="pct" rules={[{ required: true, type: 'number', min: 0.1, max: WASTAGE_ALERT_PCT }]}>
            <InputNumber<number> style={{ width: '100%' }} min={0.1} max={WASTAGE_ALERT_PCT} step={0.1} precision={2} suffix="%" />
          </Form.Item>
        </div>
        <Form.Item label="Note" name="note" rules={[{ max: 2000 }]}>
          <Input.TextArea rows={2} maxLength={2000} placeholder="e.g. Monsoon: wetter tyres expected" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
