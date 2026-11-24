import { useMemo } from 'react'
import { Alert, Form, Input, Modal, Select, Switch, Table, Tag, Button } from 'antd'
import MobileList from '../../components/MobileList'
import { useMachines, useOperators, useSaveMachine, useSaveOperator } from '../../hooks/queries/plant'
import { useIsMobile } from '../../hooks/useIsMobile'
import { errorMessage } from '../../services/apiError'
import type { Machine, MachineInput, Operator, OperatorInput } from '../../types/entries'
import { requiredMark } from '../../utils/formMarks'

const PHONE_RULE = { pattern: /^[0-9+()\- ]*$/, message: 'Digits, spaces, + - ( ) only' }

const status = (active: boolean) => (active ? <Tag color="success">Active</Tag> : <Tag>Inactive</Tag>)
const dim = (active: boolean) => ({ fontWeight: 700, opacity: active ? 1 : 0.5 })
const matches = (needle: string, ...parts: (string | null)[]) => !needle || parts.join(' ').toLowerCase().includes(needle)

export function OperatorModal({ companyId, operator, onClose }: { companyId: number; operator?: Operator; onClose: () => void }) {
  const [form] = Form.useForm<OperatorInput>()
  const save = useSaveOperator(companyId)
  const onFinish = (v: OperatorInput) =>
    save.mutate({ id: operator?.id, body: { ...v, email: v.email?.trim() || null, shift: v.shift ?? null, is_active: v.is_active ?? true } }, { onSuccess: onClose })

  return (
    <Modal open title={operator ? `Edit ${operator.name}` : 'Add an operator'} okText="Save" onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending}>
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      <Form<OperatorInput> form={form} layout="vertical" requiredMark={requiredMark} initialValues={operator ?? { is_active: true }} onFinish={onFinish} style={{ marginTop: 8 }}>
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, max: 100, message: 'Enter the name' }]}>
          <Input placeholder="e.g. Murugan K" />
        </Form.Item>
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
          <Form.Item label="Phone" name="phone" rules={[{ required: true, whitespace: true, max: 30, message: 'Enter the phone number' }, PHONE_RULE]}>
            <Input placeholder="94433 51902" />
          </Form.Item>
          <Form.Item label="Email" name="email" rules={[{ type: 'email', message: 'Enter a valid email' }, { max: 320 }]}>
            <Input placeholder="name@example.com" />
          </Form.Item>
        </div>
        <Form.Item label="Usual shift" name="shift" extra="Their names show first when the in-charge picks this shift.">
          <Select allowClear placeholder="No fixed shift" options={[1, 2, 3].map((s) => ({ value: s, label: `Shift ${s}` }))} />
        </Form.Item>
        {operator && (
          <Form.Item name="is_active" valuePropName="checked" extra="Inactive operators cannot be picked in new production entries. Old entries will not change.">
            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

export function MachineModal({ companyId, machine, onClose }: { companyId: number; machine?: Machine; onClose: () => void }) {
  const [form] = Form.useForm<MachineInput>()
  const save = useSaveMachine(companyId)
  const onFinish = (v: MachineInput) => save.mutate({ id: machine?.id, body: { ...v, is_active: v.is_active ?? true } }, { onSuccess: onClose })

  return (
    <Modal open title={machine ? `Edit ${machine.code}` : 'Add a machine'} okText="Save" onOk={() => form.submit()} onCancel={onClose} confirmLoading={save.isPending}>
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      <Form<MachineInput> form={form} layout="vertical" requiredMark={requiredMark} initialValues={machine ?? { is_active: true }} onFinish={onFinish} style={{ marginTop: 8 }}>
        <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
          <Form.Item label="Machine number" name="code" rules={[{ required: true, whitespace: true, max: 30, message: 'Enter the machine number' }]}>
            <Input placeholder="e.g. M-01" />
          </Form.Item>
          <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, max: 100, message: 'Enter the name' }]}>
            <Input placeholder="e.g. Pyrolysis reactor 1" />
          </Form.Item>
        </div>
        {machine && (
          <Form.Item name="is_active" valuePropName="checked" extra="Inactive machines cannot be picked in new production entries. Old entries will not change.">
            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

export function OperatorsTable({ companyId, q, onEdit }: { companyId: number; q: string; onEdit: (o: Operator) => void }) {
  const operators = useOperators(companyId)
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (operators.data ?? []).filter((o) => matches(needle, o.name, o.phone, o.email))
  }, [operators.data, q])
  const mobile = useIsMobile()
  if (mobile)
    return (
      <MobileList<Operator>
        rows={operators.data && rows}
        rowKey={(o) => o.id}
        loading={operators.isLoading}
        emptyText="No operators yet"
        card={(o) => ({
          title: <span style={dim(o.is_active)}>{o.name}</span>,
          extra: status(o.is_active),
          lines: [
            o.phone ? (
              <a href={`tel:${o.phone}`} className="num" onClick={(e) => e.stopPropagation()}>
                {o.phone}
              </a>
            ) : (
              <span style={{ color: '#D4380D' }}>Phone not added</span>
            ),
            o.email,
            o.shift && `Usual shift: Shift ${o.shift}`,
          ],
          onClick: () => onEdit(o),
        })}
      />
    )
  return (
    <Table<Operator>
      scroll={{ x: 'max-content' }}
      rowKey="id"
      loading={operators.isLoading}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      dataSource={rows}
      locale={{ emptyText: 'No operators yet' }}
      columns={[
        { title: 'Name', dataIndex: 'name', render: (v, o) => <span style={dim(o.is_active)}>{v}</span> },
        { title: 'Phone', dataIndex: 'phone', render: (v: string | null) => (v ? <span className="num">{v}</span> : <span style={{ color: '#D4380D' }}>Not added</span>) },
        { title: 'Email', dataIndex: 'email', render: (v: string | null) => <span className="muted">{v}</span> },
        { title: 'Usual shift', dataIndex: 'shift', render: (v: number | null) => (v ? `Shift ${v}` : <span className="faint">—</span>) },
        { title: 'Status', render: (_, o) => status(o.is_active) },
        {
          key: 'edit',
          align: 'right',
          render: (_, o) => (
            <Button type="link" onClick={() => onEdit(o)}>
              Edit
            </Button>
          ),
        },
      ]}
    />
  )
}

export function MachinesTable({ companyId, q, onEdit }: { companyId: number; q: string; onEdit: (m: Machine) => void }) {
  const machines = useMachines(companyId)
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (machines.data ?? []).filter((m) => matches(needle, m.code, m.name))
  }, [machines.data, q])
  const mobile = useIsMobile()
  if (mobile)
    return (
      <MobileList<Machine>
        rows={machines.data && rows}
        rowKey={(m) => m.id}
        loading={machines.isLoading}
        emptyText="No machines yet"
        card={(m) => ({ title: <span className="num" style={dim(m.is_active)}>{m.code}</span>, extra: status(m.is_active), lines: [m.name], onClick: () => onEdit(m) })}
      />
    )
  return (
    <Table<Machine>
      scroll={{ x: 'max-content' }}
      rowKey="id"
      loading={machines.isLoading}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      dataSource={rows}
      locale={{ emptyText: 'No machines yet' }}
      columns={[
        {
          title: 'Machine number',
          dataIndex: 'code',
          render: (v, m) => (
            <span className="num" style={dim(m.is_active)}>
              {v}
            </span>
          ),
        },
        { title: 'Name', dataIndex: 'name', render: (v, m) => <span style={dim(m.is_active)}>{v}</span> },
        { title: 'Status', render: (_, m) => status(m.is_active) },
        {
          key: 'edit',
          align: 'right',
          render: (_, m) => (
            <Button type="link" onClick={() => onEdit(m)}>
              Edit
            </Button>
          ),
        },
      ]}
    />
  )
}
