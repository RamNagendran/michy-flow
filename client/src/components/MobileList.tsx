import { useState, type Key, type ReactNode } from 'react'
import { Empty, Pagination, Skeleton } from 'antd'

export interface CardView {
  title: ReactNode
  /** Right side of the first line: a status tag or an amount. */
  extra?: ReactNode
  /** One line each under the title. Empty ones are skipped. */
  lines?: ReactNode[]
  onClick?: () => void
}

interface Props<T> {
  rows?: T[]
  rowKey: (row: T) => Key
  card: (row: T) => CardView
  loading?: boolean
  emptyText?: ReactNode
  pageSize?: number
}

/** A table's rows as cards, for phones. Pages on the phone itself, like the table it replaces. */
export default function MobileList<T>({ rows, rowKey, card, loading, emptyText = 'Nothing here yet', pageSize = 20 }: Props<T>) {
  const [page, setPage] = useState(1)
  if (!rows) return loading ? <Skeleton active style={{ padding: 16 }} /> : null
  if (!rows.length) return <Empty description={emptyText} style={{ padding: '24px 0' }} />
  // Back to a page that exists when a search shortens the list.
  const current = Math.min(page, Math.ceil(rows.length / pageSize))
  return (
    <>
      <div className={`m-cards ${loading ? 'refreshing' : 'settled'}`}>
        {rows.slice((current - 1) * pageSize, current * pageSize).map((row) => {
          const c = card(row)
          return (
            <div
              key={rowKey(row)}
              className={`m-card${c.onClick ? ' clickable' : ''}`}
              role={c.onClick ? 'button' : undefined}
              tabIndex={c.onClick ? 0 : undefined}
              onClick={c.onClick}
              onKeyDown={(e) => e.key === 'Enter' && c.onClick?.()}
            >
              <div className="m-card-line">
                <div className="strong" style={{ minWidth: 0 }}>
                  {c.title}
                </div>
                {c.extra}
              </div>
              {c.lines?.filter(Boolean).map((l, i) => (
                <div key={i} className="m-card-sub">
                  {l}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {rows.length > pageSize && <Pagination simple align="center" current={current} pageSize={pageSize} total={rows.length} onChange={setPage} style={{ padding: '4px 0 16px' }} />}
    </>
  )
}
