import { Table, Tag, Tooltip } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { MATRIX_COLUMNS, ROLE_MATRIX, roleColor, roleDescription, type MatrixColumn } from '../../utils/permissions'
import { roleLabel } from '../../utils/user'

const cell = (v: true | 'duty' | undefined) =>
  v === true ? (
    <CheckOutlined style={{ color: '#1f9d6b', fontSize: 16 }} />
  ) : v === 'duty' ? (
    <Tooltip title="Only for the duties ticked for that operator (purchase, sales or production)">
      <Tag color="blue" style={{ marginInlineEnd: 0 }}>
        If ticked
      </Tag>
    </Tooltip>
  ) : (
    <CloseOutlined style={{ color: '#c4c8cf' }} />
  )

/** Read-only table of what each role can do. The server enforces the same rules. */
export default function RolesTab() {
  return (
    <div>
      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        {MATRIX_COLUMNS.map((r) => (
          <div key={r} style={{ border: '1px solid #e8eaee', borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag color={roleColor[r]} style={{ fontWeight: 700 }}>
                {roleLabel(r)}
              </Tag>
              <span className="faint" style={{ fontSize: 12 }}>
                {r === 'super_admin' || r === 'ceo' ? 'Global' : 'Per company'}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              {roleDescription[r]}
            </div>
          </div>
        ))}
      </div>
      <Table
        scroll={{ x: 'max-content' }}
        rowKey={(r) => r[0]}
        pagination={false}
        dataSource={ROLE_MATRIX}
        columns={[
          { title: 'Action', render: (_, r) => r[0] },
          ...MATRIX_COLUMNS.map((c: MatrixColumn) => ({ title: roleLabel(c), align: 'center' as const, width: 110, render: (_: unknown, r: (typeof ROLE_MATRIX)[number]) => cell(r[1][c]) })),
        ]}
      />
    </div>
  )
}
