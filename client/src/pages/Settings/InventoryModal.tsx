import { Alert, Form, InputNumber, Modal, Segmented, Select } from 'antd'
import { companyItems, inputChoices, OIL_DENSITY, outputChoices } from '../../data/catalog'
import { useConfigureCompany } from '../../hooks/queries/companies'
import { errorMessage } from '../../services/apiError'
import type { Company, CompanyConfig } from '../../types/auth'
import { formatKg } from '../../utils/format'

const option = (i: { id: string; name: string; unit: string; stocked: boolean }) => ({
  value: i.id,
  label: `${i.name}${i.unit === 'L' ? ' (litres)' : ''}${i.stocked ? '' : ' — not stocked'}`,
})

/** Super Admin: what this company processes and makes, the oil density, and the stock-check cycle. */
export default function InventoryModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const [form] = Form.useForm<CompanyConfig>()
  const save = useConfigureCompany()
  const outputsPicked = Form.useWatch('output_items', form) ?? []
  const density = Form.useWatch('oil_density', form) ?? company.oil_density
  const current = companyItems(company)
  const initial: CompanyConfig = {
    input_items: current.inputs.map((i) => i.id),
    output_items: current.outputs.map((o) => o.id),
    oil_density: company.oil_density,
    stock_check_months: company.stock_check_months,
  }
  return (
    <Modal open width={640} title={`Inventory · ${company.name}`} okText="Save configuration" onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending}>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title="Entries already saved keep their items and weights. Only new entries follow these lists." />
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      <Form<CompanyConfig> form={form} layout="vertical" requiredMark={false} initialValues={initial} onFinish={(v) => save.mutate({ id: company.id, body: v }, { onSuccess: onClose })}>
        <Form.Item label="Input products (what it processes)" name="input_items" rules={[{ required: true, type: 'array', min: 1, message: 'Choose at least one input' }]}>
          <Select mode="multiple" options={inputChoices.map(option)} placeholder="e.g. Truck tyres, Scrap steel, Rubber crumbs" />
        </Form.Item>
        <Form.Item label="Output materials (what it makes)" name="output_items" rules={[{ required: true, type: 'array', min: 1, message: 'Choose at least one output' }]}>
          <Select mode="multiple" options={outputChoices.map(option)} placeholder="e.g. Oil, Steel, Carbon powder" />
        </Form.Item>
        {outputsPicked.includes('oil') && (
          <Form.Item
            label="Oil conversion factor (kg per litre)"
            name="oil_density"
            rules={[{ required: true, type: 'number', min: OIL_DENSITY.min, max: OIL_DENSITY.max, message: `Between ${OIL_DENSITY.min} and ${OIL_DENSITY.max}` }]}
            extra={`Oil is entered in litres and shown in kg automatically: 1,000 L = ${formatKg(1000 * (density || 0))}.`}
          >
            <InputNumber<number> min={OIL_DENSITY.min} max={OIL_DENSITY.max} step={0.001} precision={3} suffix="kg / L" style={{ width: 220 }} />
          </Form.Item>
        )}
        <Form.Item label="Admin's physical stock check" name="stock_check_months" extra="How often the Admin must count the stock and verify the deduction.">
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
