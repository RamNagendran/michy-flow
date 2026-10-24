import { useState } from 'react'
import { Segmented, Table, Tag } from 'antd'
import dayjs from 'dayjs'
import { useAuditLogs } from '../../hooks/queries/users'
import type { AuditLog } from '../../types/auth'

const actionLabel: Record<string, { label: string; color?: string }> = {
  signup: { label: 'Organisation created', color: 'purple' },
  login: { label: 'Signed in' },
  login_failed: { label: 'Failed sign-in', color: 'error' },
  password_changed: { label: 'Changed own password' },
  password_reset: { label: 'Password reset', color: 'warning' },
  user_created: { label: 'Person added', color: 'success' },
  user_updated: { label: 'Person updated' },
  user_access_changed: { label: 'Access changed', color: 'warning' },
  company_created: { label: 'Company added', color: 'success' },
  company_updated: { label: 'Company updated' },
}

const filters = [
  { value: 'all', label: 'Everything' },
  { value: 'user', label: 'People' },
  { value: 'company', label: 'Companies' },
]

/** Who did what, newest first. Rows are written by the server and cannot be edited. */
export default function AuditTab() {
  const [page, setPage] = useState(1)
  const [entity, setEntity] = useState('all')
  const logs = useAuditLogs(page, entity === 'all' ? undefined : entity)

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <Segmented
          value={entity}
          onChange={(v) => {
            setEntity(String(v))
            setPage(1)
          }}
          options={filters}
        />
      </div>
      <Table<AuditLog>
        scroll={{ x: 'max-content' }}
        rowKey="id"
        loading={logs.isFetching}
        dataSource={logs.data?.items}
        pagination={{ current: page, pageSize: logs.data?.page_size ?? 20, total: logs.data?.total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: 'When', dataIndex: 'created_at', render: (v) => <span className="num">{dayjs(v).format('DD MMM YYYY, HH:mm')}</span> },
          { title: 'Who', dataIndex: 'actor_name', render: (v) => v ?? <span className="faint">Deleted user</span> },
          {
            title: 'What',
            dataIndex: 'action',
            render: (a: string) => <Tag color={actionLabel[a]?.color} style={{ fontWeight: 700 }}>{actionLabel[a]?.label ?? a}</Tag>,
          },
          { title: 'On', render: (_, l) => <span className="muted">{l.entity_type} #{l.entity_id ?? '—'}</span> },
          {
            title: 'Details',
            dataIndex: 'details',
            render: (d: Record<string, unknown>) =>
              Object.keys(d).length ? (
                <code style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block', maxWidth: 420 }}>{JSON.stringify(d)}</code>
              ) : (
                <span className="faint">—</span>
              ),
          },
          { title: 'IP address', dataIndex: 'ip_address', render: (v) => <span className="num faint">{v ?? '—'}</span> },
        ]}
      />
    </div>
  )
}
