import { Alert, DatePicker, Form, Input, InputNumber, Modal, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { companyItems, toKg, unitOf, WASTAGE_ALERT_PCT } from '../../data/catalog'
import { itemAllowed, itemsFor } from '../../data/grades'
import { useParties } from '../../hooks/queries/parties'
import { useUpdateEntry } from '../../hooks/queries/entries'
import { errorMessage } from '../../services/apiError'
import type { EntryDetail, Grade } from '../../types/entries'
import { formatKg, kgInputProps, qtyInputProps } from '../../utils/format'
import { calculatedInput } from '../../utils/production'
import { useAccess } from '../../hooks/useAccess'
import GradePicker from './GradePicker'
import { requiredMark } from '../../utils/formMarks'

interface Values {
  entry_date: Dayjs
  party_id?: number
  grade: Grade
  item: string
  qty: number
  /** Production: a total bigger than products + 2%, used only for the wastage. */
  wastage_on?: number | null
  returned_kg?: number | null
  rate?: number
  invoice_no?: string
  shift?: number | null
  outputs?: Record<string, number | null>
  notes: string
  comment: string
}

/** Correct an entry. Saving sends it back through review, and the change is kept in its history. */
export default function EntryEditModal({ entry, onClose }: { entry: EntryDetail; onClose: () => void }) {
  const [form] = Form.useForm<Values>()
  const isProduction = entry.type === 'production'
  const grade: Grade = Form.useWatch('grade', form) ?? entry.grade
  const item: string | undefined = Form.useWatch('item', form) ?? entry.item
  const company = useAccess().accessFor(entry.company_id)?.company ?? { category: 'crumb' as const }
  const process = companyItems(company)
  // Production: stock goes down by products + 2%; a bigger total only changes the wastage.
  const outputs: Values['outputs'] = Form.useWatch('outputs', form)
  const density = 'oil_density' in company ? company.oil_density : undefined
  const outputKg = Object.entries(outputs ?? {}).reduce((s, [id, q]) => s + toKg(id, q ?? 0, density), 0)
  const leastInput = calculatedInput(outputKg)
  // The total is not saved; work it back from the wastage when it was bigger than products + 2%.
  const savedTotal = entry.calculated_input_kg !== null && entry.wastage_kg && entry.wastage_pct ? Math.round((entry.wastage_kg * 100) / entry.wastage_pct) : null
  const parties = useParties(isProduction ? undefined : entry.company_id, entry.type === 'sale' ? 'buyer' : 'supplier')
  const purchase = useUpdateEntry('purchase')
  const sale = useUpdateEntry('sale')
  const production = useUpdateEntry('production')
  const mutation = entry.type === 'purchase' ? purchase : entry.type === 'sale' ? sale : production

  const initialValues: Values = {
    entry_date: dayjs(entry.entry_date),
    party_id: entry.party_id ?? undefined,
    grade: entry.grade,
    item: entry.item,
    qty: entry.qty,
    returned_kg: entry.returned_kg || null,
    wastage_on: savedTotal !== null && entry.calculated_input_kg !== null && savedTotal > entry.calculated_input_kg ? savedTotal : null,
    rate: entry.rate ?? undefined,
    invoice_no: entry.invoice_no ?? undefined,
    shift: entry.shift,
    outputs: Object.fromEntries(process.outputs.map((o) => [o.id, entry.outputs.find((x) => x.product === o.id)?.qty ?? null])),
    notes: entry.notes,
    comment: '',
  }

  const onFinish = (v: Values) => {
    const base = { entry_date: v.entry_date.format('YYYY-MM-DD'), notes: v.notes ?? '', comment: v.comment ?? '' }
    const target = { companyId: entry.company_id, id: entry.id }
    if (entry.type === 'purchase') {
      purchase.mutate({ ...target, body: { ...base, supplier_id: v.party_id!, grade: v.grade, material: v.item, qty: v.qty, rate: v.rate!, invoice_no: v.invoice_no! } }, { onSuccess: onClose })
    } else if (entry.type === 'sale') {
      sale.mutate({ ...target, body: { ...base, buyer_id: v.party_id!, grade: v.grade, product: v.item, qty: v.qty, rate: v.rate!, invoice_no: v.invoice_no! } }, { onSuccess: onClose })
    } else {
      const outs = Object.entries(v.outputs ?? {}).map(([product, qty]) => ({ product, qty: qty ?? 0 }))
      production.mutate({ ...target, body: { ...base, material: v.item, wastage_on_kg: v.wastage_on ?? null, returned_kg: v.returned_kg ?? 0, shift: v.shift ?? null, crew_ids: entry.crew.map((c) => c.id), running_hours: entry.running_hours, outputs: outs } }, { onSuccess: onClose })
    }
  }

  const items = entry.type === 'production' ? process.inputs : itemsFor(entry.type, grade, company)
  const unit = item ? unitOf(item) : 'kg'
  return (
    <Modal open title={`Edit ${entry.ref_no}`} okText="Save changes" onOk={() => form.submit()} onCancel={onClose} confirmLoading={mutation.isPending} width={720}>
      {mutation.isError && <Alert type="error" showIcon title={errorMessage(mutation.error)} style={{ marginBottom: 12 }} />}
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title="After you save, it goes back to the Manager, then Finance. The old values are kept in its history." />
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark={requiredMark}
        initialValues={initialValues}
        onFinish={onFinish}
        onValuesChange={(changed) => {
          if (entry.type !== 'production' && changed.grade && !itemAllowed(entry.type, changed.grade, company, form.getFieldValue('item'))) form.setFieldValue('item', undefined)
        }}
      >
        {entry.type !== 'production' && (
          <Form.Item label="Grade" name="grade" rules={[{ required: true }]} extra="If you change the grade, the stock also moves to that grade.">
            <GradePicker kind={entry.type} />
          </Form.Item>
        )}
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
          <Form.Item label="Date" name="entry_date" rules={[{ required: true }]}>
            <DatePicker format="DD MMM YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} allowClear={false} />
          </Form.Item>
          <Form.Item label={isProduction ? 'Raw material' : 'Item'} name="item" rules={[{ required: true }]}>
            <Select options={items.map((i) => ({ value: i.id as string, label: i.name }))} />
          </Form.Item>
          {!isProduction && (
            <>
              <Form.Item label={entry.type === 'sale' ? 'Buyer' : 'Supplier'} name="party_id" rules={[{ required: true }]}>
                <Select loading={parties.isLoading} showSearch={{ optionFilterProp: 'label' }} options={parties.data?.map((p) => ({ value: p.id, label: `${p.name}${p.is_active ? '' : ' (inactive)'}` }))} />
              </Form.Item>
              <Form.Item label="Bill / invoice no." name="invoice_no" rules={[{ required: true, whitespace: true, max: 50 }]}>
                <Input />
              </Form.Item>
            </>
          )}
          {isProduction ? (
            <Form.Item
              label="Total raw material (kg)"
              name="wastage_on"
              dependencies={['outputs']}
              rules={[{ validator: async (_: unknown, v?: number | null) => (v == null || v >= leastInput ? undefined : Promise.reject(new Error(`It cannot be less than ${formatKg(leastInput)}`))) }]}
              extra={`${formatKg(leastInput)} (products + ${WASTAGE_ALERT_PCT}%) is taken out of stock. Leave empty to use it. A bigger total only changes the wastage.`}
            >
              <InputNumber<number> style={{ width: '100%' }} placeholder={String(leastInput)} {...kgInputProps} />
            </Form.Item>
          ) : (
            <Form.Item label={`Quantity (${unit})`} name="qty" rules={[{ required: true, type: 'number', min: 0.001 }]}>
              <InputNumber<number> style={{ width: '100%' }} {...qtyInputProps(unit)} />
            </Form.Item>
          )}
          {isProduction ? (
            <Form.Item label="Shift" name="shift">
              <Select allowClear options={[1, 2, 3].map((s) => ({ value: s, label: `Shift ${s}` }))} />
            </Form.Item>
          ) : (
            <Form.Item label={`Rate per ${unit === "L" ? "litre" : "kg"}`} name="rate" rules={[{ required: true, type: 'number', min: 0 }]}>
              <InputNumber style={{ width: '100%' }} prefix="₹" suffix={`/${unit}`} min={0} step={0.1} precision={2} />
            </Form.Item>
          )}
        </div>
        {isProduction && (
          <div className="grid grid-3" style={{ columnGap: 12, rowGap: 0 }}>
            <Form.Item
              label="Returned to stock (kg)"
              name="returned_kg"
              dependencies={['outputs']}
              rules={[{ validator: async (_: unknown, v?: number | null) => (!v || v < leastInput ? undefined : Promise.reject(new Error(`Must be less than ${formatKg(leastInput)}`))) }]}
              extra="Added back to stock"
            >
              <InputNumber<number> style={{ width: '100%' }} placeholder="0" {...kgInputProps} />
            </Form.Item>
            {process.outputs.map((o) => (
              <Form.Item key={o.id} label={`${o.name} (${o.unit})`} name={['outputs', o.id]}>
                <InputNumber<number> style={{ width: '100%' }} {...qtyInputProps(o.unit)} />
              </Form.Item>
            ))}
          </div>
        )}
        <Form.Item label="Notes" name="notes">
          <Input.TextArea rows={2} maxLength={2000} />
        </Form.Item>
        <Form.Item label="Reason for the change" name="comment" rules={[{ required: true, whitespace: true, message: 'Say what you corrected and why' }]}>
          <Input.TextArea rows={2} maxLength={2000} placeholder="e.g. Weight corrected to the weighbridge slip" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
