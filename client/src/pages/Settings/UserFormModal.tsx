import { useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, Modal, Segmented, Select } from 'antd'
import { DeleteOutlined, MailOutlined, PlusOutlined } from '@ant-design/icons'
import { useCreateUser, useSendUserOtp, useSetUserAccess } from '../../hooks/queries/users'
import { useResendTimer } from '../../hooks/useResendTimer'
import { errorMessage } from '../../services/apiError'
import type { Company, CompanyRole, Duty, GlobalRole, ManagedUser, MembershipInput, UserWithPassword } from '../../types/auth'
import { companyRoleLabel, dutyLabel, globalRoleLabel, roleDescription } from '../../utils/permissions'
import { requiredMark } from '../../utils/formMarks'

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
  const sendOtp = useSendUserOtp()
  const editing = !!user
  // A new person must prove the email is theirs: we mail them a code, they read it out to you.
  const email = (Form.useWatch('email', form) ?? '').trim().toLowerCase()
  const [sentTo, setSentTo] = useState('')
  const [otp, setOtp] = useState('')
  const { waitSeconds, start: startTimer } = useResendTimer()
  const codeSent = !editing && !!sentTo && sentTo === email
  const mutation = user ? setAccess : codeSent ? create : sendOtp
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
    else if (codeSent) create.mutate({ ...access, full_name: v.full_name.trim(), email: v.email.trim(), otp }, { onSuccess: onCreated })
    else sendCode(v)
  }

  const sendCode = (v: Pick<FormValues, 'email' | 'full_name'>) =>
    sendOtp.mutate(
      { email: v.email.trim(), full_name: v.full_name.trim() },
      {
        onSuccess: (res) => {
          setSentTo(v.email.trim().toLowerCase())
          setOtp('')
          create.reset()
          startTimer(res.resend_after_seconds)
        },
      },
    )
  const resend = () => {
    const v = form.getFieldsValue(['email', 'full_name'])
    sendCode(v)
  }

  // Each company can be picked once: hide companies already chosen in other rows.
  const taken = new Set(memberships.map((m) => m?.company_id).filter(Boolean))

  return (
    <Modal
      open
      title={editing ? `Access for ${user.full_name}` : 'Add a person'}
      okText={editing ? 'Save access' : codeSent ? 'Verify and add person' : 'Send code to their email'}
      okButtonProps={{ disabled: codeSent && otp.length !== 6 }}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      width={680}
    >
      {mutation.isError && <Alert type="error" showIcon title={errorMessage(mutation.error)} style={{ marginBottom: 16 }} />}
      {codeSent && sendOtp.isError && <Alert type="error" showIcon title={errorMessage(sendOtp.error)} style={{ marginBottom: 16 }} />}
      {editing && <Alert type="info" showIcon title="When you save, this person is logged out. They get the new access when they log in again." style={{ marginBottom: 16 }} />}
      <Form<FormValues> form={form} layout="vertical" requiredMark={requiredMark} initialValues={initialValues} onFinish={onFinish} style={{ marginTop: 8 }}>
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

        {codeSent && (
          <div style={{ background: '#fdeef2', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 4 }}>
              <MailOutlined style={{ color: '#D82E54' }} /> Code sent to {sentTo}
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Ask them for the 6-digit code and type it here. It works for 10 minutes.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Input.OTP length={6} value={otp} onChange={setOtp} formatter={(v) => v.replace(/\D/g, '')} disabled={create.isPending} autoFocus />
              <Button type="link" style={{ padding: 0 }} onClick={resend} loading={sendOtp.isPending} disabled={waitSeconds > 0 || create.isPending}>
                {waitSeconds > 0 ? `Resend code in ${waitSeconds}s` : 'Resend code'}
              </Button>
            </div>
          </div>
        )}

        <Form.Item name="level" label="Access level" rules={[{ required: true }]}>
          <Segmented<Level>
            block
            options={[
              { value: 'company', label: 'Company level (Manager, Finance, In-charge)' },
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
                      <div className="membership-grid">
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
                          label="Work"
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
