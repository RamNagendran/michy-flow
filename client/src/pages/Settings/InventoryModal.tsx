import { Alert, Form, InputNumber, Modal, Segmented, Select } from 'antd'
import { companyItems, inputChoices, itemName, KG_PER_LITRE, kgPerLitre, outputChoices, unitOf } from '../../data/catalog'
import { useConfigureCompany } from '../../hooks/queries/companies'
import { errorMessage } from '../../services/apiError'
import type { Company, CompanyConfig } from '../../types/auth'
import { formatKg } from '../../utils/format'
import { requiredMark } from '../../utils/formMarks'

const option = (i: { id: string; name: string; unit: string; stocked: boolean }) => ({
  value: i.id,
  label: `${i.name}${i.unit === 'L' ? ' (litres)' : ''}${i.stocked ? '' : ' — only recorded'}`,
})

/** Super Admin: what this company processes and makes, its own kg per litre, and the stock-check cycle. */
export default function InventoryModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const [form] = Form.useForm<CompanyConfig>()
  const save = useConfigureCompany()
  const inputsPicked: string[] = Form.useWatch('input_items', form) ?? []
  const outputsPicked: string[] = Form.useWatch('output_items', form) ?? []
  const factors: CompanyConfig['kg_per_litre'] = Form.useWatch('kg_per_litre', form) ?? {}
  // Litres items this company uses: each may have the company's own kg per litre.
  const litreItems = [...new Set([...inputsPicked, ...outputsPicked])].filter((id) => unitOf(id) === 'L')
  const current = companyItems(company)
  const stockedOutput = new Set(outputChoices().filter((o) => o.stocked).map((o) => o.id))
  const initial: CompanyConfig = {
    input_items: current.inputs.map((i) => i.id),
    output_items: current.outputs.map((o) => o.id),
    kg_per_litre: company.kg_per_litre,
    stock_check_months: company.stock_check_months,
  }
  return (
    <Modal open width={640} title={`Stock settings · ${company.name}`} okText="Save" onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending}>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title="If you change this, only new entries will use it. Old entries will not change." />
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      <Form<CompanyConfig> form={form} layout="vertical" requiredMark={requiredMark} initialValues={initial} onFinish={(v) => {
          // Only the numbers filled in, for litres items still picked; empty means "use the item's".
          const own = Object.fromEntries(litreItems.flatMap((id) => (v.kg_per_litre?.[id] != null ? [[id, v.kg_per_litre[id]]] : [])))
          save.mutate({ id: company.id, body: { ...v, kg_per_litre: own } }, { onSuccess: onClose })
        }}
      >
        <Form.Item
          label="INPUT (RM): what it processes"
          name="input_items"
          rules={[{ required: true, type: 'array', min: 1, message: 'Choose at least one input' }]}
          extra="At least one."
        >
          <Select mode="multiple" options={inputChoices().map(option)} placeholder="e.g. Truck tyres, Scrap steel, Rubber crumbs" />
        </Form.Item>
        <Form.Item
          label="OUTPUT (FG): what it makes"
          name="output_items"
          rules={[
            { required: true, type: 'array', min: 1, message: 'Choose at least one output' },
            // Same rule as the server: a company must make something that goes into stock.
            {
              validator: async (_, v: string[] | undefined) =>
                !v?.length || v.some((id) => stockedOutput.has(id)) ? undefined : Promise.reject(new Error('Pick at least one item that goes to stock. Waste alone is not enough.')),
            },
          ]}
          extra="Pick at least one item that goes to stock. Items marked “only recorded” are not counted."
        >
          <Select mode="multiple" options={outputChoices().map(option)} placeholder="e.g. Oil, Steel, Carbon powder" />
        </Form.Item>
        {litreItems.map((id) => (
          <Form.Item
            key={id}
            label={`Weight of 1 litre of ${itemName(id)} (optional)`}
            name={['kg_per_litre', id]}
            rules={[{ type: 'number', min: KG_PER_LITRE.min, max: KG_PER_LITRE.max, message: `Enter between ${KG_PER_LITRE.min} and ${KG_PER_LITRE.max} kg` }]}
            extra={
              factors[id] != null
                ? `This company's own number: 1,000 litres = ${formatKg(1000 * factors[id])}.`
                : `Empty: uses the item's number, ${kgPerLitre(id)} kg per litre. Fill only if this company's ${itemName(id).toLowerCase()} weighs different.`
            }
          >
            <InputNumber<number> min={KG_PER_LITRE.min} max={KG_PER_LITRE.max} step={0.001} precision={3} suffix="kg per litre" placeholder={String(kgPerLitre(id))} style={{ width: 220 }} />
          </Form.Item>
        ))}
        <Form.Item label="Super Admin's physical stock check" name="stock_check_months" rules={[{ required: true }]} extra="How often the Super Admin should count the stock and check it.">
          <Segmented
            options={[
              { value: 1, label: 'Every month' },
              { value: 3, label: 'Every 3 months' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
