import { Alert, Button, Checkbox, Form, Input, Modal, Segmented, Select } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useCreateUser, useSetUserAccess } from '../../hooks/queries/users'
import { errorMessage } from '../../services/apiError'
import type { Company, CompanyRole, Duty, GlobalRole, ManagedUser, MembershipInput, UserWithPassword } from '../../types/auth'
import { companyRoleLabel, dutyLabel, globalRoleLabel, roleDescription } from '../../utils/permissions'

type Level = 'company' | 'global'

interface FormValues {
  full_name: string
  email: string
  level: Level
  global_role?: GlobalRole
  memberships: MembershipInput[]
}

const COMPANY_ROLES = Object.keys(companyRoleLabel) as CompanyRole[]
const DUTIES = Object.keys(dutyLabel) as Duty[]

interface Props {
  /** Edit this person's access; leave out to add a new person. */
  user?: ManagedUser
  companies: Company[]
  onClose: () => void
  onCreated: (result: UserWithPassword) => void
}

/**
 * Add a person, or change what an existing person can access.
 * The parent mounts this only while it is open, so every opening starts from a clean form.
 */
export default function UserFormModal({ user, companies, onClose, onCreated }: Props) {
  const [form] = Form.useForm<FormValues>()
  const level = Form.useWatch('level', form)
  const globalRole = Form.useWatch('global_role', form)
  const memberships = Form.useWatch('memberships', form) ?? []
  const create = useCreateUser()
  const setAccess = useSetUserAccess()
  const mutation = user ? setAccess : create
  const editing = !!user
  const initialValues: Partial<FormValues> = {
    level: user?.global_role ? 'global' : 'company',
    global_role: user?.global_role ?? 'ceo',
    memberships: user?.memberships.map((m) => ({ company_id: m.company.id, role: m.role, duties: m.duties })) ?? [{ role: 'operator', duties: [] } as unknown as MembershipInput],
  }

  const onFinish = (v: FormValues) => {
    const access = {
      global_role: v.level === 'global' ? v.global_role! : null,
      memberships: v.level === 'company' ? v.memberships.map((m) => ({ ...m, duties: m.role === 'operator' ? m.duties : [] })) : [],
    }
    if (user) setAccess.mutate({ id: user.id, body: access }, { onSuccess: onClose })
    else create.mutate({ ...access, full_name: v.full_name.trim(), email: v.email.trim() }, { onSuccess: onCreated })
  }

  // Each company can be picked once: hide companies already chosen in other rows.
  const taken = new Set(memberships.map((m) => m?.company_id).filter(Boolean))

  return (
    <Modal
      open
      title={editing ? `Access for ${user.full_name}` : 'Add a person'}
      okText={editing ? 'Save access' : 'Add person'}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      width={680}
    >
      {mutation.isError && <Alert type="error" showIcon title={errorMessage(mutation.error)} style={{ marginBottom: 16 }} />}
      {editing && <Alert type="info" showIcon title="Saving signs this person out everywhere, so the new access applies at once." style={{ marginBottom: 16 }} />}
      <Form<FormValues> form={form} layout="vertical" requiredMark={false} initialValues={initialValues} onFinish={onFinish} style={{ marginTop: 8 }}>
        {!editing && (
          <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
            <Form.Item label="Full name" name="full_name" rules={[{ required: true, whitespace: true, max: 200, message: 'Enter their name' }]}>
              <Input placeholder="e.g. Anitha Raj" />
            </Form.Item>
            <Form.Item label="Work email" name="email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}>
              <Input placeholder="name@michy.in" autoComplete="off" />
            </Form.Item>
          </div>
        )}

        <Form.Item name="level" label="Access level">
          <Segmented<Level>
            block
            options={[
              { value: 'company', label: 'Company level (Manager, Admin, Finance, Operator)' },
              { value: 'global', label: 'Global (Super Admin, CEO)' },
            ]}
          />
        </Form.Item>

        {level === 'global' ? (
          <Form.Item name="global_role" label="Global role" rules={[{ required: true }]} extra={globalRole && roleDescription[globalRole]}>
            <Select options={(Object.keys(globalRoleLabel) as GlobalRole[]).map((r) => ({ value: r, label: globalRoleLabel[r] }))} />
          </Form.Item>
        ) : (
          <Form.List
            name="memberships"
            rules={[{ validator: async (_, rows) => (rows?.length ? undefined : Promise.reject(new Error('Add at least one company'))) }]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field) => {
                  const row = memberships[field.name]
                  return (
                    <div key={field.key} style={{ border: '1px solid #e8eaee', borderRadius: 12, padding: '14px 14px 0', marginBottom: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 32px', gap: 12, alignItems: 'start' }}>
                        <Form.Item name={[field.name, 'company_id']} rules={[{ required: true, message: 'Choose a company' }]}>
                          <Select
                            placeholder="Company"
                            showSearch={{ optionFilterProp: 'label' }}
                            options={companies
                              .filter((c) => c.id === row?.company_id || !taken.has(c.id))
                              .map((c) => ({ value: c.id, label: `${c.name}${c.is_active ? '' : ' (inactive)'}` }))}
                          />
                        </Form.Item>
                        <Form.Item name={[field.name, 'role']} rules={[{ required: true }]}>
                          <Select options={COMPANY_ROLES.map((r) => ({ value: r, label: companyRoleLabel[r] }))} />
                        </Form.Item>
                        <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} disabled={fields.length === 1} aria-label="Remove company" />
                      </div>
                      {row?.role === 'operator' ? (
                        <Form.Item
                          name={[field.name, 'duties']}
                          label="Can enter"
                          rules={[{ validator: async (_, v) => (v?.length ? undefined : Promise.reject(new Error('Tick at least one'))) }]}
                        >
                          <Checkbox.Group options={DUTIES.map((d) => ({ value: d, label: dutyLabel[d] }))} />
                        </Form.Item>
                      ) : (
                        <div className="faint" style={{ fontSize: 12.5, marginTop: -12, marginBottom: 14 }}>
                          {row?.role && roleDescription[row.role]}
                        </div>
                      )}
                    </div>
                  )
                })}
                <Form.ErrorList errors={errors} />
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => add({ role: 'operator', duties: [] })}
                  disabled={fields.length >= companies.length}
                  style={{ marginBottom: 8 }}
                >
                  Add another company
                </Button>
              </>
            )}
          </Form.List>
        )}
      </Form>
    </Modal>
  )
}
