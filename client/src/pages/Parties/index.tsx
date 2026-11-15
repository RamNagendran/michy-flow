import { useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Segmented, Switch, Table, Tag } from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { PageHeader } from '../../components/ui'
import { useParties, useSaveParty } from '../../hooks/queries/parties'
import { useAccess } from '../../hooks/useAccess'
import { errorMessage } from '../../services/apiError'
import type { Machine, Operator, Party, PartyInput, PartyKind } from '../../types/entries'
import { requiredMark } from '../../utils/formMarks'
import { gstinRule, normaliseGstin } from '../../utils/gstin'
import { MachineModal, MachinesTable, OperatorModal, OperatorsTable } from './PlantLists'

type Tab = PartyKind | 'operator' | 'machine'

const TABS: { value: Tab; label: string; add: string; search: string }[] = [
  { value: 'supplier', label: 'Suppliers', add: 'Add a supplier', search: 'Search name, city or GST number' },
  { value: 'buyer', label: 'Buyers', add: 'Add a buyer', search: 'Search name, city or GST number' },
  { value: 'operator', label: 'Operators', add: 'Add an operator', search: 'Search name, phone or email' },
  { value: 'machine', label: 'Machines', add: 'Add a machine', search: 'Search number or name' },
]

function PartyModal({ companyId, kind, party, onClose }: { companyId: number; kind: PartyKind; party?: Party; onClose: () => void }) {
  const [form] = Form.useForm<PartyInput>()
  const save = useSaveParty(companyId)
  const label = kind === 'supplier' ? 'supplier' : 'buyer'
  const onFinish = (v: PartyInput) =>
    save.mutate({ id: party?.id, body: { ...v, gstin: normaliseGstin(v.gstin), kind, is_active: v.is_active ?? true } }, { onSuccess: onClose })

  return (
    <Modal open title={party ? `Edit ${party.name}` : `Add a ${label}`} okText="Save" onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending}>
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      <Form<PartyInput> form={form} layout="vertical" requiredMark={requiredMark} initialValues={party ? { ...party, gstin: party.gstin ?? '' } : { is_active: true, gstin: '', city: '', contact_name: '', phone: '' }} onFinish={onFinish} style={{ marginTop: 8 }}>
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, max: 200, message: 'Enter the name' }]}>
          <Input placeholder="e.g. Sri Balaji Tyre Traders" />
        </Form.Item>
        <Form.Item label="GST number" name="gstin" required rules={[gstinRule]} normalize={(v: string) => v.toUpperCase()} extra={`Bills ${kind === 'supplier' ? 'from' : 'to'} this ${label} must show this number.`}>
          <Input placeholder="33AEPPM7308L3Z1" maxLength={20} />
        </Form.Item>
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
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
          <Form.Item name="is_active" valuePropName="checked" extra="Inactive suppliers or buyers cannot be picked in new entries. Old entries will not change.">
            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

export default function Parties() {
  const { scope, can } = useAccess()
  const [tab, setTab] = useState<Tab>('supplier')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Party | 'new' | null>(null)
  const [editingOperator, setEditingOperator] = useState<Operator | 'new' | null>(null)
  const [editingMachine, setEditingMachine] = useState<Machine | 'new' | null>(null)
  const current = scope[0]
  // Operators and machines are kept by the Manager (and the Super Admin) only.
  const canPlant = !!current && can('manage_plant', current.id)
  const isParty = tab === 'supplier' || tab === 'buyer'
  const kind: PartyKind = tab === 'buyer' ? 'buyer' : 'supplier'
  const parties = useParties(isParty ? current?.id : undefined, kind)
  const canManage = !!current && (isParty ? can('manage_parties', current.id) : canPlant)
  const tabs = TABS.filter((t) => canPlant || t.value === 'supplier' || t.value === 'buyer')
  const meta = TABS.find((t) => t.value === tab)!
  const add = () => (tab === 'operator' ? setEditingOperator('new') : tab === 'machine' ? setEditingMachine('new') : setEditing('new'))
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (parties.data ?? []).filter((p) => !needle || `${p.name} ${p.city} ${p.gstin ?? ''}`.toLowerCase().includes(needle))
  }, [parties.data, q])

  return (
    <div className="page">
      <PageHeader
        title={canPlant ? 'Suppliers & plant' : 'Suppliers & buyers'}
        subtitle={canPlant ? 'Each company has its own lists. Only the Manager can add or edit. In-charges pick from them when entering bills and production.' : 'Each company has its own list. The Manager can add or edit. Everyone can pick from it when entering bills.'}
        extra={
          canManage && (
            <Button type="primary" size="large" icon={<PlusOutlined />} onClick={add}>
              {meta.add}
            </Button>
          )
        }
      />
      <div className="surface table-card">
        <div style={{ display: 'flex', gap: 10, padding: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented<Tab> value={tab} onChange={setTab} options={tabs.map((t) => ({ value: t.value, label: t.label }))} />
          <Input prefix={<SearchOutlined className="faint" />} placeholder={meta.search} allowClear value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        </div>
        {tab === 'operator' && current && <OperatorsTable companyId={current.id} q={q} onEdit={setEditingOperator} />}
        {tab === 'machine' && current && <MachinesTable companyId={current.id} q={q} onEdit={setEditingMachine} />}
        {isParty && (
          <Table<Party>
            scroll={{ x: 'max-content' }}
            rowKey="id"
            loading={parties.isLoading}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            dataSource={rows}
            columns={[
              { title: 'Name', dataIndex: 'name', render: (v, p) => <span style={{ fontWeight: 700, opacity: p.is_active ? 1 : 0.5 }}>{v}</span> },
              { title: 'GST number', dataIndex: 'gstin', render: (v: string | null) => (v ? <span className="num">{v}</span> : <span style={{ color: '#D4380D' }}>Not added</span>) },
              { title: 'City', dataIndex: 'city' },
              { title: 'Contact', dataIndex: 'contact_name' },
              { title: 'Phone', dataIndex: 'phone', render: (v) => <span className="num muted">{v}</span> },
              { title: 'Status', render: (_, p) => (p.is_active ? <Tag color="success">Active</Tag> : <Tag>Inactive</Tag>) },
              ...(canManage ? [{ key: 'edit', align: 'right' as const, render: (_: unknown, p: Party) => <Button type="link" onClick={() => setEditing(p)}>Edit</Button> }] : []),
            ]}
          />
        )}
      </div>
      {editingOperator && current && <OperatorModal key={editingOperator === 'new' ? 'new' : editingOperator.id} companyId={current.id} operator={editingOperator === 'new' ? undefined : editingOperator} onClose={() => setEditingOperator(null)} />}
      {editingMachine && current && <MachineModal key={editingMachine === 'new' ? 'new' : editingMachine.id} companyId={current.id} machine={editingMachine === 'new' ? undefined : editingMachine} onClose={() => setEditingMachine(null)} />}
      {editing && current && <PartyModal key={editing === 'new' ? 'new' : editing.id} companyId={current.id} kind={kind} party={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
