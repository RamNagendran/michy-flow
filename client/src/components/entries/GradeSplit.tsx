import { gradeInfo, type TradeKind } from '../../data/grades'
import type { GradeTotal } from '../../types/entries'
import { formatINRShort, formatQty, formatKg } from '../../utils/format'

/** Period totals split into Grade A, B and C. */
export default function GradeSplit({ kind, totals }: { kind: TradeKind; totals: GradeTotal[] }) {
  return (
    <div className="grid grid-3" style={{ marginBottom: 20 }}>
      {totals.map((t) => {
        const g = gradeInfo(t.grade)
        return (
          <div key={t.grade} className="surface" style={{ padding: '14px 18px', borderLeft: `4px solid ${g.fg}` }}>
            <div style={{ fontWeight: 800, color: g.fg, fontSize: 13 }}>
              {g.name} · {g.short}
            </div>
            <div className="num strong" style={{ fontSize: 20, marginTop: 2 }}>
              {formatINRShort(t.amount)}
            </div>
            <div className="faint" style={{ fontSize: 12.5 }}>
              {t.grade === 'C' ? `${t.count} entries · no goods moved` : `${formatKg(t.qty_kg)}${t.qty_l ? ` + ${formatQty(t.qty_l, "L")}` : ""} · ${t.count} ${kind === 'purchase' ? 'bills' : 'invoices'}`} · {g[kind].toLowerCase()}
            </div>
          </div>
        )
      })}
    </div>
  )
}
