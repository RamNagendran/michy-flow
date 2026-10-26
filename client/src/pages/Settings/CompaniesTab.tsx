import { useState } from 'react'
import { Alert, App, Button, Form, Input, Modal, Radio, Switch, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { CompanyBadge } from '../../components/CompanyCards'
import { useCompanies, useSaveCompany } from '../../hooks/queries/companies'
import { PROCESSES, processOf } from '../../data/catalog'
import { errorMessage } from '../../services/apiError'
import type { Company, CompanyInput } from '../../types/auth'
import { useAccess } from '../../hooks/useAccess'
import InventoryModal from './InventoryModal'
import { requiredMark } from '../../utils/formMarks'

/** Same rule as the server (server/app/schemas/company.py). */

/** Mounted only while open, so each opening starts from a clean form. */
function CompanyModal({ company, onClose }: { company?: Company; onClose: () => void }) {
  const [form] = Form.useForm<CompanyInput>()
  const save = useSaveCompany()

  const onFinish = (v: CompanyInput) =>
    save.mutate(
      {
        id: company?.id,
        body: {
          code: v.code.trim().toUpperCase(),
          name: v.name.trim(),
          city: (v.city ?? '').trim(),
          // Sent only when it changes: the server refuses a change once the company has entries.
          ...(company?.category === v.category ? {} : { category: v.category }),
        },
      },
      { onSuccess: onClose },
    )

  return (
    <Modal open width={680} title={company ? `Edit ${company.name}` : 'Add a company'} okText={company ? 'Save' : 'Add company'} onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending}>
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 16 }} />}
      <Form<CompanyInput> form={form} layout="vertical" requiredMark={requiredMark} initialValues={company ?? { city: '' }} onFinish={onFinish} style={{ marginTop: 8 }}>
        <div className="grid" style={{ gridTemplateColumns: '140px 1fr', columnGap: 16, rowGap: 0 }}>
          <Form.Item
            label="Code"
            name="code"
            normalize={(v: string) => v.toUpperCase()}
            rules={[{ required: true, pattern: /^[A-Za-z0-9]{1,10}$/, message: '1–10 letters or digits' }]}
            extra="On badges and reference numbers"
          >
            <Input placeholder="MR" maxLength={10} />
          </Form.Item>
          <Form.Item label="Company name" name="name" rules={[{ required: true, whitespace: true, max: 200, message: 'Enter the company name' }]}>
            <Input placeholder="Michy Rubbers Pvt Ltd" />
          </Form.Item>
        </div>
        <Form.Item
          label="Company type"
          name="category"
          rules={[{ required: true, message: 'Choose what this company does' }]}
          extra={company ? 'Can be changed only until the company has its first entry.' : 'Decides the raw material it processes and the products it makes.'}
        >
          <Radio.Group style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, width: '100%' }}>
            {PROCESSES.map((p) => (
              <Radio key={p.id} value={p.id} style={{ margin: 0, padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e6e8ec', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 800 }}>{p.name}</div>
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.35 }}>
                  {p.summary}
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {p.example}
                </div>
              </Radio>
            ))}
          </Radio.Group>
        </Form.Item>
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
          <Form.Item label="City" name="city" rules={[{ max: 100 }]}>
            <Input placeholder="Gummidipoondi" />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  )
}

export default function CompaniesTab() {
  const companies = useCompanies()
  const save = useSaveCompany()
  const { modal } = App.useApp()
  const [editing, setEditing] = useState<Company | null>(null)
  const [adding, setAdding] = useState(false)
  const [configuring, setConfiguring] = useState<Company | null>(null)
  const canConfigure = useAccess().canSystem('manage_config')

  const toggle = (c: Company) =>
    modal.confirm({
      title: c.is_active ? `Deactivate ${c.name}?` : `Re-activate ${c.name}?`,
      content: c.is_active
        ? 'Nobody except a Super Admin can open it while it is inactive. Its data and memberships are kept.'
        : 'Its members get their access back at once.',
      okText: c.is_active ? 'Deactivate' : 'Re-activate',
      okButtonProps: { danger: c.is_active },
      onOk: () => save.mutateAsync({ id: c.id, body: { is_active: !c.is_active } }),
    })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="muted">Each company (entity) keeps its own purchases, production, stock and sales.</div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          Add a company
        </Button>
      </div>
      <Table<Company>
        scroll={{ x: 'max-content' }}
        rowKey="id"
        loading={companies.isLoading}
        pagination={false}
        dataSource={companies.data}
        columns={[
          {
            title: 'Company',
            render: (_, c) => (
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: c.is_active ? 1 : 0.55 }}>
                <CompanyBadge code={c.code} size={34} />
                <span>
                  <div style={{ fontWeight: 700 }}>{c.name}</div>
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    {processOf(c.category).name} · {c.city || '—'}
                  </div>
                </span>
              </span>
            ),
          },
          { title: 'Status', render: (_, c) => (c.is_active ? <Tag color="success">Active</Tag> : <Tag>Inactive</Tag>) },
          { title: 'Active', render: (_, c) => <Switch size="small" checked={c.is_active} onChange={() => toggle(c)} aria-label={`Active: ${c.name}`} /> },
          {
            key: 'edit',
            align: 'right',
            render: (_, c) => (
              <span style={{ whiteSpace: 'nowrap' }}>
                {canConfigure && (
                  <Button type="link" onClick={() => setConfiguring(c)}>
                    Stock settings
                  </Button>
                )}
                <Button type="link" onClick={() => setEditing(c)}>
                  Edit
                </Button>
              </span>
            ),
          },
        ]}
      />
      {configuring && <InventoryModal key={configuring.id} company={configuring} onClose={() => setConfiguring(null)} />}
      {(adding || editing) && (
        <CompanyModal
          key={editing?.id ?? 'new'}
          company={editing ?? undefined}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
