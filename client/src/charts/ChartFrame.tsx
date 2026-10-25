import { useState, type ReactNode } from 'react'
import { Button, Empty, Skeleton, Tooltip } from 'antd'
import { BarChartOutlined, TableOutlined } from '@ant-design/icons'

export interface TableView {
  columns: string[]
  rows: (string | number)[][]
}

interface Props {
  title: ReactNode
  sub?: ReactNode
  extra?: ReactNode
  loading?: boolean
  /** Previous data stays on screen, dimmed, while new data loads. */
  refreshing?: boolean
  empty?: boolean
  emptyText?: string
  /** Height of the chart area. */
  height?: number
  /** Every value the chart shows, as a table: reachable without hovering. */
  table?: TableView
  className?: string
  children: ReactNode
}

/** The compact card every dashboard chart sits in: title, chart/table switch, loading and empty states. */
export default function ChartFrame({ title, sub, extra, loading, refreshing, empty, emptyText = 'Nothing recorded in this period', height = 220, table, className, children }: Props) {
  const [asTable, setAsTable] = useState(false)
  const showTable = asTable && !!table
  return (
    <section className={`surface viz-card fade-in ${className ?? ''}`}>
      <header className="viz-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="viz-title">{title}</h3>
          {sub && <div className="viz-sub">{sub}</div>}
        </div>
        <div className="viz-tools">
          {extra}
          {table && !empty && !loading && (
            <Tooltip title={showTable ? 'Show chart' : 'Show as table'}>
              <Button size="small" type="text" icon={showTable ? <BarChartOutlined /> : <TableOutlined />} onClick={() => setAsTable((v) => !v)} aria-label={showTable ? 'Show chart' : 'Show as table'} />
            </Tooltip>
          )}
        </div>
      </header>
      <div style={{ height }} className={refreshing ? 'refreshing' : 'settled'}>
        {loading ? (
          <Skeleton active title={false} paragraph={{ rows: Math.max(3, Math.floor(height / 40)) }} />
        ) : empty ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} style={{ margin: 0, paddingTop: Math.max(height / 2 - 50, 8) }} />
        ) : showTable ? (
          <div className="viz-table" style={{ height }}>
            <table>
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
