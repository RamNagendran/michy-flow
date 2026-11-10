import { Alert, DatePicker, Form, Input, InputNumber, Modal, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { companyItems, toKg, unitOf } from '../../data/catalog'
import { itemAllowed, itemsFor } from '../../data/grades'
import { useParties } from '../../hooks/queries/parties'
import { useUpdateEntry } from '../../hooks/queries/entries'
import { errorMessage } from '../../services/apiError'
import type { EntryDetail, Grade, WastageType } from '../../types/entries'
import { formatKgFine, kgInputProps, perUnit, qtyInputProps, unitWord } from '../../utils/format'
import { rawMaterialUsed, WASTAGE_TYPES, wastageTypeLabel } from '../../utils/production'
import { useAccess } from '../../hooks/useAccess'
import GradePicker from './GradePicker'
import VehicleNumbersInput from './VehicleNumbersInput'
import { requiredMark } from '../../utils/formMarks'

interface Values {
  entry_date: Dayjs
  party_id?: number
  grade: Grade
  item: string
  qty: number
  /** Production: wastage on the run and its type, both or neither. */
  wastage_type?: WastageType | null
  wastage_kg?: number | null
  returned_kg?: number | null
  rate?: number
  invoice_no?: string
  vehicle_nos?: string[]
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
  // Production: stock goes down by products + wastage; the wastage is not a product.
  const outputs: Values['outputs'] = Form.useWatch('outputs', form)
  const wastageType: WastageType | null | undefined = Form.useWatch('wastage_type', form)
  const wastageKg: number | null | undefined = Form.useWatch('wastage_kg', form)
  const density = 'oil_density' in company ? company.oil_density : undefined
  const outputKg = Object.entries(outputs ?? {}).reduce((s, [id, q]) => s + toKg(id, q ?? 0, density), 0)
  const usedKg = rawMaterialUsed(outputKg, wastageType ? (wastageKg ?? 0) : 0)
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
    // Older runs have a 2% wastage with no type: it stays only if a type is chosen.
    wastage_type: entry.wastage_type,
    wastage_kg: entry.wastage_kg || null,
    rate: entry.rate ?? undefined,
    invoice_no: entry.invoice_no ?? undefined,
    vehicle_nos: entry.vehicle_nos ?? [],
    shift: entry.shift,
    outputs: Object.fromEntries(process.outputs.map((o) => [o.id, entry.outputs.find((x) => x.product === o.id)?.qty ?? null])),
    notes: entry.notes,
    comment: '',
  }

  const onFinish = (v: Values) => {
    const base = { entry_date: v.entry_date.format('YYYY-MM-DD'), notes: v.notes ?? '', comment: v.comment ?? '' }
    const target = { companyId: entry.company_id, id: entry.id }
    if (entry.type === 'purchase') {
      purchase.mutate({ ...target, body: { ...base, supplier_id: v.party_id!, grade: v.grade, material: v.item, qty: v.qty, rate: v.rate!, invoice_no: v.invoice_no!, vehicle_nos: v.vehicle_nos ?? [] } }, { onSuccess: onClose })
    } else if (entry.type === 'sale') {
      sale.mutate({ ...target, body: { ...base, buyer_id: v.party_id!, grade: v.grade, product: v.item, qty: v.qty, rate: v.rate!, invoice_no: v.invoice_no! } }, { onSuccess: onClose })
    } else {
      const outs = Object.entries(v.outputs ?? {}).map(([product, qty]) => ({ product, qty: qty ?? 0 }))
      production.mutate({ ...target, body: { ...base, material: v.item, wastage_kg: v.wastage_type ? (v.wastage_kg ?? null) : null, wastage_type: v.wastage_type ?? null, returned_kg: v.returned_kg ?? 0, shift: v.shift ?? null, crew_ids: entry.crew.map((c) => c.id), running_hours: entry.running_hours, outputs: outs } }, { onSuccess: onClose })
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
            <GradePicker />
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
              {entry.type === 'purchase' && (
                <Form.Item label="Vehicle numbers" name="vehicle_nos" style={{ gridColumn: '1 / -1' }}>
                  <VehicleNumbersInput />
                </Form.Item>
              )}
            </>
          )}
          {isProduction ? (
            <Form.Item label="Wastage" style={{ marginBottom: 0 }} extra={`Raw material used: ${formatKgFine(usedKg)} (products + wastage)`}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Form.Item name="wastage_type" noStyle>
                  <Select<WastageType> allowClear placeholder="No wastage" style={{ width: 140 }} options={WASTAGE_TYPES.map((w) => ({ value: w, label: wastageTypeLabel[w] }))} />
                </Form.Item>
                <Form.Item name="wastage_kg" noStyle dependencies={['wastage_type']} rules={[{ validator: async (_: unknown, v?: number | null) => (!form.getFieldValue('wastage_type') || (v ?? 0) > 0 ? undefined : Promise.reject(new Error('Enter the wastage kg'))) }]}>
                  <InputNumber<number> style={{ flex: 1 }} placeholder="0" disabled={!wastageType} {...kgInputProps} />
                </Form.Item>
              </div>
            </Form.Item>
          ) : (
            <Form.Item label={`Quantity (${unitWord(unit)})`} name="qty" rules={[{ required: true, type: 'number', min: 0.001 }]}>
              <InputNumber<number> style={{ width: '100%' }} {...qtyInputProps(unit)} />
            </Form.Item>
          )}
          {isProduction ? (
            <Form.Item label="Shift" name="shift">
              <Select allowClear options={[1, 2, 3].map((s) => ({ value: s, label: `Shift ${s}` }))} />
            </Form.Item>
          ) : (
            <Form.Item label={`Rate per ${unit === "L" ? "litre" : "kg"}`} name="rate" rules={[{ required: true, type: 'number', min: 0 }]}>
              <InputNumber style={{ width: '100%' }} prefix="₹" suffix={perUnit(unit)} min={0} step={0.1} precision={2} />
            </Form.Item>
          )}
        </div>
        {isProduction && (
          <div className="grid grid-3" style={{ columnGap: 12, rowGap: 0 }}>
            <Form.Item
              label="Returned to stock (kg)"
              name="returned_kg"
              dependencies={['outputs', 'wastage_type', 'wastage_kg']}
              rules={[{ validator: async (_: unknown, v?: number | null) => (!v || v < usedKg ? undefined : Promise.reject(new Error(`Must be less than ${formatKgFine(usedKg)}`))) }]}
              extra="Added back to stock"
            >
              <InputNumber<number> style={{ width: '100%' }} placeholder="0" {...kgInputProps} />
            </Form.Item>
            {process.outputs.map((o) => (
              <Form.Item key={o.id} label={`${o.name} (${unitWord(o.unit)})`} name={['outputs', o.id]}>
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
