import { Alert, ColorPicker, Form, Input, InputNumber, Modal, Radio, Select } from 'antd'
import { HintButton } from '../../components/ui'
import { inputChoices, KG_PER_LITRE, outputChoices, type CatalogItem, type CatalogItemRow, type CompanyTypeRow } from '../../data/catalog'
import { useSaveItem, useSaveType, type ItemInput, type TypeInput } from '../../hooks/queries/catalog'
import { errorMessage } from '../../services/apiError'
import { formatKg } from '../../utils/format'
import { requiredMark } from '../../utils/formMarks'

/** Colours to pick from quickly; any other colour can still be chosen. */
const PRESETS = ['#2F6FEB', '#0F9D8A', '#5E8C31', '#B8860B', '#7A5AF8', '#6B7280', '#C2410C', '#D82E54', '#4A7FC1', '#1BAF7A', '#A1A1AA', '#0E9384']

/** Only the fields that changed, so a locked field the Super Admin left alone is never sent. */
function changed<T extends object>(before: Partial<T> | undefined, after: T): Partial<T> {
  if (!before) return after
  return Object.fromEntries(Object.entries(after).filter(([k, v]) => JSON.stringify(before[k as keyof T]) !== JSON.stringify(v))) as Partial<T>
}

/** Add or change an item. Mounted only while open, so each opening starts clean. */
export function ItemModal({ item, onClose }: { item?: CatalogItemRow; onClose: () => void }) {
  const [form] = Form.useForm<ItemInput>()
  const save = useSaveItem()
  const kind = Form.useWatch('kind', form) ?? item?.kind ?? 'material'
  const unit = Form.useWatch('unit', form) ?? item?.unit ?? 'kg'
  const kgPerLitre: number | null | undefined = Form.useWatch('kg_per_litre', form)
  const initial: ItemInput = item ?? {
    name: '',
    description: '',
    kind: 'material',
    unit: 'kg',
    stocked: true,
    kg_per_litre: null,
    color: PRESETS[0],
  }

  const onFinish = (v: ItemInput) => {
    const body: ItemInput = {
      ...v,
      name: v.name.trim(),
      description: (v.description ?? '').trim(),
      stocked: v.kind === 'material' ? true : v.stocked,
      kg_per_litre: v.unit === 'L' ? (v.kg_per_litre ?? null) : null,
    }
    const diff = changed(item, body)
    if (item && !Object.keys(diff).length) return onClose()
    save.mutate({ id: item?.id, body: diff }, { onSuccess: onClose })
  }

  return (
    <Modal open width={560} title={item ? `Edit ${item.name}` : 'Add an item'} okText={item ? 'Save' : 'Add item'} onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending}>
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 16 }} />}
      <Form<ItemInput> form={form} layout="vertical" requiredMark={requiredMark} initialValues={initial} onFinish={onFinish} style={{ marginTop: 8 }}>
        <div className="grid" style={{ gridTemplateColumns: '1fr 120px', columnGap: 16, rowGap: 0 }}>
          <Form.Item
            label="Name"
            name="name"
            rules={[
              {
                required: true,
                whitespace: true,
                max: 60,
                message: 'Enter the item name',
              },
            ]}
          >
            <Input placeholder="e.g. Conveyor belts" maxLength={60} />
          </Form.Item>
          <Form.Item label="Colour" name="color" getValueFromEvent={(c) => c.toHexString().toUpperCase()}>
            <ColorPicker disabledAlpha presets={[{ label: 'Colours', colors: PRESETS }]} />
          </Form.Item>
        </div>
        <Form.Item label="Description" name="description" rules={[{ max: 200 }]}>
          <Input placeholder="e.g. Old rubber conveyor belts from mines" maxLength={200} />
        </Form.Item>
        <Form.Item label="What is it?" name="kind" rules={[{ required: true }]}>
          <Radio.Group
            optionType="button"
            options={[
              { value: 'material', label: 'INPUT (RM)' },
              { value: 'product', label: 'OUTPUT (FG)' },
            ]}
          />
        </Form.Item>
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
          <Form.Item label="Measured in" name="unit" rules={[{ required: true }]}>
            <Radio.Group
              optionType="button"
              options={[
                { value: 'kg', label: 'kg' },
                { value: 'L', label: 'litres' },
              ]}
            />
          </Form.Item>
          {kind === 'product' && (
            <Form.Item
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  After production
                  <HintButton title="After production" label="What is this?">
                    <p>
                      <b>Goes to stock:</b> what production makes is added to stock. You can sell it, and it shows in stock and in stock checks. For example oil, steel, crumb.
                    </p>
                    <p>
                      <b>Only recorded:</b> the weight is saved in the production entry and counted in the weight balance, but it never goes into stock and cannot be sold. For example waste for disposal.
                    </p>
                    <p>INPUT (RM) items always go to stock.</p>
                  </HintButton>
                </span>
              }
              name="stocked"
            >
              <Radio.Group
                optionType="button"
                options={[
                  { value: true, label: 'Goes to stock' },
                  { value: false, label: 'Only recorded' },
                ]}
              />
            </Form.Item>
          )}
        </div>
        {unit === 'L' && (
          <Form.Item
            label="Weight of 1 litre"
            name="kg_per_litre"
            rules={[{ required: true, type: 'number', min: KG_PER_LITRE.min, max: KG_PER_LITRE.max, message: `Enter between ${KG_PER_LITRE.min} and ${KG_PER_LITRE.max} kg` }]}
            extra={kgPerLitre ? `1,000 litres = ${formatKg(1000 * kgPerLitre)}. A company can use its own number in its Stock settings.` : 'Production is weighed in kg, so litres are changed to kg with this. Oil is about 1.040.'}
          >
            <InputNumber<number> min={KG_PER_LITRE.min} max={KG_PER_LITRE.max} step={0.001} precision={3} suffix="kg per litre" placeholder="e.g. 1.040" style={{ width: 220 }} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

const option = (i: CatalogItem) => ({
  value: i.id,
  label: `${i.name}${i.unit === 'L' ? ' (litres)' : ''}${i.stocked ? '' : ' · only recorded'}`,
})

/** Add or change a company type: its name and default inputs and outputs. */
export function TypeModal({ row, onClose }: { row?: CompanyTypeRow; onClose: () => void }) {
  const [form] = Form.useForm<TypeInput>()
  const save = useSaveType()
  const outputs = outputChoices()
  const stockedOutput = new Set(outputs.filter((o) => o.stocked).map((o) => o.id))
  const initial: TypeInput = row ?? {
    name: '',
    example: '',
    input_items: [],
    output_items: [],
  }

  const onFinish = (v: TypeInput) => {
    const body: TypeInput = {
      ...v,
      name: v.name.trim(),
      example: (v.example ?? '').trim(),
    }
    const diff = changed(row, body)
    if (row && !Object.keys(diff).length) return onClose()
    save.mutate({ id: row?.id, body: diff }, { onSuccess: onClose })
  }

  return (
    <Modal open width={640} title={row ? `Edit ${row.name}` : 'Add a company type'} okText={row ? 'Save' : 'Add type'} onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending}>
      {row && row.companies > 0 && <Alert type="info" showIcon style={{ marginBottom: 16 }} title="Only new companies will use this. Companies already added keep their own stock settings." />}
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 16 }} />}
      <Form<TypeInput> form={form} layout="vertical" requiredMark={requiredMark} initialValues={initial} onFinish={onFinish} style={{ marginTop: 8 }}>
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
          <Form.Item
            label="Name"
            name="name"
            rules={[
              {
                required: true,
                whitespace: true,
                max: 60,
                message: 'Enter the type name',
              },
            ]}
          >
            <Input placeholder="e.g. Belt recycling" maxLength={60} />
          </Form.Item>
          <Form.Item label="Example company" name="example" rules={[{ max: 100 }]}>
            <Input placeholder="e.g. Chennai Belt Works" maxLength={100} />
          </Form.Item>
        </div>
        <Form.Item
          label="INPUT (RM): what it processes"
          name="input_items"
          rules={[
            {
              required: true,
              type: 'array',
              min: 1,
              message: 'Choose at least one input',
            },
          ]}
        >
          <Select mode="multiple" options={inputChoices().map(option)} placeholder="e.g. Truck tyres, Scrap steel" optionFilterProp="label" />
        </Form.Item>
        <Form.Item
          label="OUTPUT (FG): what it makes"
          name="output_items"
          rules={[
            {
              required: true,
              type: 'array',
              min: 1,
              message: 'Choose at least one output',
            },
            {
              validator: async (_, v: string[] | undefined) =>
                !v?.length || v.some((id) => stockedOutput.has(id)) ? undefined : Promise.reject(new Error('Pick at least one item that goes to stock. Waste alone is not enough.')),
            },
          ]}
        >
          <Select mode="multiple" options={outputs.map(option)} placeholder="e.g. Oil, Steel, Carbon powder" optionFilterProp="label" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
