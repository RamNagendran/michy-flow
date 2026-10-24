import { useMemo, useState } from 'react'
import { App, Avatar, Button, Dropdown, Input, Table, Tag, Tooltip } from 'antd'
import { KeyOutlined, MoreOutlined, PlusOutlined, SafetyOutlined, SearchOutlined, StopOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useCompanies } from '../../hooks/queries/companies'
import { useResetPassword, useUpdateUser, useUsers } from '../../hooks/queries/users'
import { useAuth } from '../../hooks/useAuth'
import type { ManagedUser, UserWithPassword } from '../../types/auth'
import { formatDate } from '../../utils/format'
import { companyRoleLabel, dutyLabel, globalRoleLabel, roleColor } from '../../utils/permissions'
import { initials } from '../../utils/user'
import TemporaryPasswordModal from './TemporaryPasswordModal'
import UserFormModal from './UserFormModal'

function AccessCell({ user }: { user: ManagedUser }) {
  if (user.global_role) {
    return (
      <Tag color={roleColor[user.global_role]} style={{ fontWeight: 700 }}>
        {globalRoleLabel[user.global_role]} · all companies
      </Tag>
    )
  }
  if (!user.memberships.length) return <span className="faint">No access yet</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {user.memberships.map((m) => (
        <span key={m.company.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Tag color={roleColor[m.role]} style={{ fontWeight: 700, marginInlineEnd: 0 }}>
            {companyRoleLabel[m.role]}
          </Tag>
          <b>{m.company.name}</b>
          {m.duties.length > 0 && <span className="faint">({m.duties.map((d) => dutyLabel[d]).join(', ')})</span>}
        </span>
      ))}
    </div>
  )
}

export default function UsersTab() {
  const { user: me } = useAuth()
  const { modal } = App.useApp()
  const users = useUsers()
  const companies = useCompanies()
  const update = useUpdateUser()
  const reset = useResetPassword()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [adding, setAdding] = useState(false)
  const [password, setPassword] = useState<UserWithPassword | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = users.data ?? []
    return needle ? list.filter((u) => `${u.full_name} ${u.email}`.toLowerCase().includes(needle)) : list
  }, [users.data, q])

  const confirmReset = (u: ManagedUser) =>
    modal.confirm({
      title: `Reset ${u.full_name}'s password?`,
      content: 'They are signed out everywhere and get a new temporary password, which you will see once.',
      okText: 'Reset password',
      onOk: () => reset.mutateAsync(u.id).then(setPassword),
    })

  const confirmActive = (u: ManagedUser) =>
    modal.confirm({
      title: u.is_active ? `Deactivate ${u.full_name}?` : `Re-activate ${u.full_name}?`,
      content: u.is_active ? 'They are signed out at once and cannot sign in until re-activated. Their past entries stay.' : 'They can sign in again with their password.',
      okText: u.is_active ? 'Deactivate' : 'Re-activate',
      okButtonProps: { danger: u.is_active },
      onOk: () => update.mutateAsync({ id: u.id, body: { is_active: !u.is_active } }),
    })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <Input prefix={<SearchOutlined className="faint" />} placeholder="Search name or email" allowClear value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)} disabled={!companies.data}>
          Add a person
        </Button>
      </div>
      <Table<ManagedUser>
        scroll={{ x: 'max-content' }}
        rowKey="id"
        loading={users.isLoading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        dataSource={rows}
        columns={[
          {
            title: 'Person',
            render: (_, u) => (
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: u.is_active ? 1 : 0.55 }}>
                <Avatar style={{ background: roleColor[u.global_role ?? u.memberships[0]?.role ?? 'operator'], fontWeight: 700 }}>{initials(u)}</Avatar>
                <span>
                  <div style={{ fontWeight: 700 }}>
                    {u.full_name} {u.id === me?.id && <Tag style={{ marginInlineStart: 4 }}>You</Tag>}
                  </div>
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    {u.email}
                  </div>
                </span>
              </span>
            ),
          },
          { title: 'Access', render: (_, u) => <AccessCell user={u} /> },
          {
            title: 'Status',
            render: (_, u) =>
              !u.is_active ? (
                <Tag>Deactivated</Tag>
              ) : u.must_change_password ? (
                <Tooltip title="Has not yet replaced the temporary password">
                  <Tag color="warning">Awaiting first sign-in</Tag>
                </Tooltip>
              ) : (
                <Tag color="success">Active</Tag>
              ),
          },
          { title: 'Last sign-in', render: (_, u) => <span className="muted">{u.last_login_at ? formatDate(u.last_login_at) : '—'}</span> },
          {
            key: 'actions',
            align: 'right',
            render: (_, u) =>
              // Your own access is changed by another Super Admin, so you cannot lock yourself out.
              u.id === me?.id ? null : (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      { key: 'access', icon: <SafetyOutlined />, label: 'Change access' },
                      { key: 'reset', icon: <KeyOutlined />, label: 'Reset password' },
                      { type: 'divider' },
                      u.is_active
                        ? { key: 'active', icon: <StopOutlined />, label: 'Deactivate', danger: true }
                        : { key: 'active', icon: <CheckCircleOutlined />, label: 'Re-activate' },
                    ],
                    onClick: ({ key }) => (key === 'access' ? setEditing(u) : key === 'reset' ? confirmReset(u) : confirmActive(u)),
                  }}
                >
                  <Button type="text" icon={<MoreOutlined />} aria-label={`Actions for ${u.full_name}`} />
                </Dropdown>
              ),
          },
        ]}
      />

      {(adding || editing) && (
        <UserFormModal
          key={editing?.id ?? 'new'}
          user={editing ?? undefined}
          companies={companies.data ?? []}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onCreated={(result) => {
            setAdding(false)
            setPassword(result)
          }}
        />
      )}
      <TemporaryPasswordModal result={password} onClose={() => setPassword(null)} />
    </div>
  )
}
