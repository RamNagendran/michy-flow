import { Button, Table } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { WastageMonth } from '../../types/reports'
import { formatKg, formatKgFine, formatPercent } from '../../utils/format'
import { approvable } from './wastageMeta'
import { WastageStatusTag } from './WastageStatusTag'

/** Month by month, newest first. The Super Admin can tick several months and approve them together. */
export default function MonthTable({
  months,
  loading,
  canApprove,
  selected,
  onSelect,
  onOpen,
  onApprove,
}: {
  months: WastageMonth[]
  loading: boolean
  canApprove: boolean
  selected: string[]
  onSelect: (months: string[]) => void
  onOpen: (month: string) => void
  onApprove: () => void
}) {
  return (
    <div className="surface chart-card fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="chart-title">Month by month</div>
          <div className="chart-sub">Click a month to see details and history</div>
        </div>
        {canApprove && (
          <Button type="primary" icon={<CheckOutlined />} disabled={!selected.length} onClick={onApprove}>
            Approve {selected.length || ''} selected
          </Button>
        )}
      </div>
      <Table<WastageMonth>
        size="small"
        rowKey="month"
        loading={loading}
        pagination={false}
        dataSource={[...months].reverse()}
        scroll={{ y: 300 }}
        locale={{ emptyText: 'No production in this period' }}
        onRow={(m) => ({
          // A click on the tick box selects the month; anywhere else opens it.
          onClick: (e) => !(e.target as HTMLElement).closest('.ant-table-selection-column') && onOpen(m.month),
          style: { cursor: 'pointer' },
        })}
        rowSelection={
          canApprove
            ? {
                selectedRowKeys: selected,
                onChange: (keys) => onSelect(keys as string[]),
                getCheckboxProps: (m) => ({ disabled: !approvable(m) }),
              }
            : undefined
        }
        columns={[
          { title: 'Month', render: (_, m) => <b>{dayjs(m.month).format('MMM YYYY')}</b> },
          { title: 'Runs', align: 'right', render: (_, m) => m.runs },
          { title: 'Processed', align: 'right', render: (_, m) => <span className="num">{formatKg(m.processed_kg)}</span> },
          {
            title: 'Wastage',
            align: 'right',
            render: (_, m) => (
              <span className="num">
                <b>{formatKgFine(m.wastage_kg)}</b> <span className="faint">{formatPercent(m.wastage_pct, 2)}</span>
                {m.changed && <div style={{ fontSize: 12, color: '#D98A0B' }}>was {formatKgFine(m.calculated_kg)}</div>}
              </span>
            ),
          },
          { title: 'Status', render: (_, m) => <WastageStatusTag status={m.status} /> },
        ]}
      />
    </div>
  )
}
