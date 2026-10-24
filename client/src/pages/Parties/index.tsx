import { useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Segmented, Select, Switch, Table, Tag } from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { PageHeader } from '../../components/ui'
import { useParties, useSaveParty } from '../../hooks/queries/parties'
import { useAccess } from '../../hooks/useAccess'
import { errorMessage } from '../../services/apiError'
import type { Party, PartyInput, PartyKind } from '../../types/entries'

/** Same rule as the server (server/app/schemas/company.py). */
const GSTIN = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

function PartyModal({ companyId, kind, party, onClose }: { companyId: number; kind: PartyKind; party?: Party; onClose: () => void }) {
  const [form] = Form.useForm<PartyInput>()
  const save = useSaveParty(companyId)
  const label = kind === 'supplier' ? 'supplier' : 'buyer'
  const onFinish = (v: PartyInput) =>
    save.mutate({ id: party?.id, body: { ...v, kind, gstin: v.gstin?.trim().toUpperCase() || null, is_active: v.is_active ?? true } }, { onSuccess: onClose })

  return (
    <Modal open title={party ? `Edit ${party.name}` : `Add a ${label}`} okText="Save" onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending}>
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      <Form<PartyInput> form={form} layout="vertical" requiredMark={false} initialValues={party ?? { is_active: true, city: '', contact_name: '', phone: '' }} onFinish={onFinish} style={{ marginTop: 8 }}>
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, max: 200, message: 'Enter the name' }]}>
          <Input placeholder="e.g. Sri Balaji Tyre Traders" />
        </Form.Item>
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
          <Form.Item
            label="GSTIN"
            name="gstin"
            normalize={(v: string) => v.toUpperCase()}
            extra="Used to match uploaded bills to this party"
            rules={[{ validator: async (_, v) => (!v || GSTIN.test(v.trim()) ? undefined : Promise.reject(new Error('Not a valid GSTIN'))) }]}
          >
            <Input placeholder="33AAKFS4821M1Z6" maxLength={15} />
          </Form.Item>
          <Form.Item label="City" name="city" rules={[{ max: 100 }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Contact person" name="contact_name" rules={[{ max: 200 }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Phone" name="phone" rules={[{ max: 30, pattern: /^[0-9+()\- ]*$/, message: 'Digits, spaces, + - ( ) only' }]}>
            <Input />
          </Form.Item>
        </div>
        {party && (
          <Form.Item label="Active" name="is_active" valuePropName="checked" extra="Inactive parties cannot be picked on new entries; old entries keep them.">
            <Switch />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

export default function Parties() {
  const { scope, can } = useAccess()
  const [companyId, setCompanyId] = useState<number | undefined>(scope[0]?.id)
  const [kind, setKind] = useState<PartyKind>('supplier')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Party | 'new' | null>(null)
  const current = scope.find((c) => c.id === companyId) ?? scope[0]
  const parties = useParties(current?.id, kind)
  const canManage = !!current && can('manage_parties', current.id)
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (parties.data ?? []).filter((p) => !needle || `${p.name} ${p.gstin ?? ''} ${p.city}`.toLowerCase().includes(needle))
  }, [parties.data, q])

  return (
    <div className="page">
      <PageHeader
        title="Suppliers & buyers"
        subtitle="Each company keeps its own list. Managers and Admins can add and edit; everyone can pick from it when entering bills."
        extra={
          canManage && (
            <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
              Add a {kind}
            </Button>
          )
        }
      />
      <div className="surface table-card">
        <div style={{ display: 'flex', gap: 10, padding: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {scope.length > 1 && <Select style={{ width: 220 }} value={current?.id} onChange={setCompanyId} options={scope.map((c) => ({ value: c.id, label: c.name }))} />}
          <Segmented<PartyKind> value={kind} onChange={setKind} options={[{ value: 'supplier', label: 'Suppliers' }, { value: 'buyer', label: 'Buyers' }]} />
          <Input prefix={<SearchOutlined className="faint" />} placeholder="Search name, GSTIN or city" allowClear value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        </div>
        <Table<Party>
          scroll={{ x: 'max-content' }}
          rowKey="id"
          loading={parties.isLoading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          dataSource={rows}
          columns={[
            { title: 'Name', dataIndex: 'name', render: (v, p) => <span style={{ fontWeight: 700, opacity: p.is_active ? 1 : 0.5 }}>{v}</span> },
            { title: 'GSTIN', dataIndex: 'gstin', render: (v) => (v ? <span className="num">{v}</span> : <span className="faint">—</span>) },
            { title: 'City', dataIndex: 'city' },
            { title: 'Contact', dataIndex: 'contact_name' },
            { title: 'Phone', dataIndex: 'phone', render: (v) => <span className="num muted">{v}</span> },
            { title: 'Status', render: (_, p) => (p.is_active ? <Tag color="success">Active</Tag> : <Tag>Inactive</Tag>) },
            ...(canManage ? [{ key: 'edit', align: 'right' as const, render: (_: unknown, p: Party) => <Button type="link" onClick={() => setEditing(p)}>Edit</Button> }] : []),
          ]}
        />
      </div>
      {editing && current && <PartyModal key={editing === 'new' ? 'new' : editing.id} companyId={current.id} kind={kind} party={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
