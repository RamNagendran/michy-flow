import type { ReactNode } from 'react'
import { Empty, Skeleton } from 'antd'

interface Props {
  title: ReactNode
  sub?: ReactNode
  legend?: { label: string; color: string; dashed?: boolean }[]
  extra?: ReactNode
  loading?: boolean
  /** Previous data still on screen while new data loads: dimmed rather than replaced. */
  refreshing?: boolean
  empty?: boolean
  emptyText?: string
  height?: number
  children: ReactNode
}

/** The frame every report chart sits in: title, legend, and loading and empty states. */
export default function ChartCard({ title, sub, legend, extra, loading, refreshing, empty, emptyText = 'Nothing recorded in this period', height = 260, children }: Props) {
  return (
    <div className="surface chart-card fade-in">
      <div className="chart-head">
        <div>
          <div className="chart-title">{title}</div>
          {sub && <div className="chart-sub">{sub}</div>}
        </div>
        {extra}
      </div>
      {legend && (
        <div className="legend" style={{ marginBottom: 8 }}>
          {legend.map((l) => (
            <span key={l.label}>
              <i style={{ width: 14, height: 3, borderRadius: 2, background: l.dashed ? 'transparent' : l.color, borderTop: l.dashed ? `2px dashed ${l.color}` : undefined, display: 'inline-block' }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ height }} className={refreshing ? 'refreshing' : 'settled'}>
        {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : empty ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} style={{ paddingTop: height / 4 }} /> : children}
      </div>
    </div>
  )
}
