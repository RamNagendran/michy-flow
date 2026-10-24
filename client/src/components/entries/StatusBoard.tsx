import { Skeleton, Tooltip } from 'antd'
import { useStatusSummary } from '../../hooks/queries/entries'
import { usePeriod } from '../../hooks/usePeriod'
import type { Company } from '../../types/auth'
import type { EntryStatus, EntryType } from '../../types/entries'
import { statusMeta } from '../../utils/entryStatus'
import { formatINRShort } from '../../utils/format'

const ORDER: EntryStatus[] = ['pending', 'approved', 'on_hold', 'verified', 'rejected']
const COLORS: Record<EntryStatus, string> = { pending: '#D98A0B', approved: '#2F6FEB', on_hold: '#D4380D', verified: '#1F9D6B', rejected: '#C9CED6' }

/**
 * Where this period's entries stand: pending, approved, on hold, verified, rejected. Operators
 * (e.g. the purchase in-charge) see their own entries; everyone else sees the whole company.
 */
export default function StatusBoard({ type, companies }: { type: EntryType; companies: Company[] }) {
  const { range, label } = usePeriod()
  const summary = useStatusSummary({ type: [type], company_id: companies.map((c) => c.id), date_from: range[0], date_to: range[1] }, companies.length > 0)
  const rows = ORDER.map((s) => summary.data?.find((r) => r.status === s) ?? { status: s, count: 0, amount: 0 })
  const total = rows.reduce((n, r) => n + r.count, 0)
  const open = rows.filter((r) => r.status === 'pending' || r.status === 'approved' || r.status === 'on_hold').reduce((n, r) => n + r.count, 0)

  return (
    <div className={`surface chart-card fade-in ${summary.isPlaceholderData ? 'refreshing' : 'settled'}`} style={{ marginBottom: 20 }}>
      <div className="chart-head">
        <div>
          <div className="chart-title">Status · {label.toLowerCase()}</div>
          <div className="chart-sub">
            {total ? `${total} entries · ${open} not final yet` : 'Nothing entered in this period'}
          </div>
        </div>
      </div>
      {summary.isLoading ? (
        <Skeleton active paragraph={{ rows: 1 }} />
      ) : (
        <>
          <div style={{ display: 'flex', height: 12, borderRadius: 99, overflow: 'hidden', background: '#eef0f3' }} aria-label="Share of entries in each status">
            {rows.map((r) =>
              r.count ? (
                <Tooltip key={r.status} title={`${statusMeta[r.status].label}: ${r.count}`}>
                  <div style={{ width: `${(r.count / total) * 100}%`, background: COLORS[r.status], transition: 'width .5s cubic-bezier(.2,.7,.2,1)' }} />
                </Tooltip>
              ) : null,
            )}
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
            {rows.map((r) => (
              <div key={r.status}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800, color: '#5b6270' }}>
                  <span className="legend-dot" style={{ background: COLORS[r.status] }} />
                  {statusMeta[r.status].label}
                </div>
                <div className="num strong" style={{ fontSize: 20 }}>
                  {r.count}
                </div>
                {type !== 'production' && <div className="faint num" style={{ fontSize: 12.5 }}>{formatINRShort(r.amount)}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
