import { Empty, Skeleton, Tag } from 'antd'
import { WarningFilled } from '@ant-design/icons'
import { itemColor, itemName, WASTAGE_ALERT_PCT } from '../../data/catalog'
import type { EntryRow } from '../../types/entries'
import { formatDate, formatINR, formatKg, formatPercent, formatQty, formatRateIn } from '../../utils/format'
import { GradeTag, StatusTag } from '../ui'
import { typeMeta } from './typeMeta'

export const Item = ({ id }: { id: string }) => (
  <span className="pill" style={{ background: '#fff', border: '1px solid #e6e8ec', color: '#3a3f47' }}>
    <span className="legend-dot" style={{ background: itemColor(id) }} />
    {itemName(id)}
  </span>
)

interface Props {
  rows?: EntryRow[]
  loading: boolean
  /** Show the entry type on each card (lists that mix purchases, production and sales). */
  showType: boolean
  showCompany: boolean
  onOpen: (r: EntryRow) => void
}

/** The entry list on a phone: one card per entry instead of a wide table. Tap a card for the full entry. */
export default function EntryCards({ rows, loading, showType, showCompany, onOpen }: Props) {
  if (!rows) return loading ? <Skeleton active style={{ padding: 16 }} /> : null
  if (!rows.length) return <Empty description="Nothing here yet" style={{ padding: '24px 0' }} />
  return (
    <div className={`entry-cards ${loading ? 'refreshing' : 'settled'}`}>
      {rows.map((r) => {
        const highWastage = (r.wastage_pct ?? 0) > WASTAGE_ALERT_PCT
        return (
          <div key={`${r.type}-${r.id}`} className="entry-card" role="button" tabIndex={0} onClick={() => onOpen(r)} onKeyDown={(e) => e.key === 'Enter' && onOpen(r)}>
            <div className="entry-card-line">
              <div style={{ minWidth: 0 }}>
                <span className="id-link">{r.ref_no}</span>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {showType && (
                    <span style={{ color: typeMeta[r.type].fg, fontWeight: 700 }}>
                      {typeMeta[r.type].icon} {typeMeta[r.type].label} ·{' '}
                    </span>
                  )}
                  {formatDate(r.entry_date)}
                  {showCompany && ` · ${r.company_name}`}
                </div>
              </div>
              <StatusTag status={r.status} />
            </div>
            {r.party_name && (
              <div style={{ fontWeight: 700 }}>
                {r.party_name}
                {r.invoice_no && <span className="faint" style={{ fontWeight: 500, fontSize: 12.5 }}> · Bill {r.invoice_no}</span>}
              </div>
            )}
            {r.open_debit_notes > 0 && (
              <Tag color="orange" icon={<WarningFilled />} style={{ alignSelf: 'flex-start' }}>
                {r.open_debit_notes === 1 ? 'Debit note open' : `${r.open_debit_notes} debit notes open`}
              </Tag>
            )}
            <div className="entry-card-line">
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
                <Item id={r.item} />
                <GradeTag grade={r.grade} />
              </span>
              <span className="num strong">{formatQty(r.qty, r.unit)}</span>
            </div>
            {r.amount !== null && (
              <div className="entry-card-line">
                <span className="faint num">{formatRateIn(r.rate ?? 0, r.unit)}</span>
                <span className="num" style={{ fontWeight: 800 }}>{formatINR(r.amount)}</span>
              </div>
            )}
            {r.output_kg !== null && (
              <div className="entry-card-line">
                <span className="faint">Output {formatKg(r.output_kg)}</span>
                <span className="num" style={{ fontWeight: 700, fontSize: 12.5, color: highWastage ? '#D4380D' : '#8a919e' }}>
                  {highWastage && <WarningFilled />} {formatPercent(r.wastage_pct ?? 0)} wastage
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
