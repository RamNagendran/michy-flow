import { Skeleton } from 'antd'
import { itemName } from '../data/catalog'
import { gradeInfo } from '../data/grades'
import { seriesColors } from '../styles/theme'
import type { CompanyRef } from '../types/auth'
import type { CompanyStock, Grade, StockLine, StockSection } from '../types/entries'
import { formatQty } from '../utils/format'
import { activeLines } from '../utils/stock'

const color = (item: string) => seriesColors[item as keyof typeof seriesColors] ?? '#8a919e'

/** The stock each sale grade takes from, with words a sales person understands. */
const GROUPS: { grade: Grade; section: StockSection; title: string }[] = [
  { grade: 'A', section: 'output', title: 'Made in our plant' },
  { grade: 'B', section: 'resale', title: 'Bought to sell again' },
  { grade: 'C', section: 'books', title: 'Bill only (no goods)' },
]

interface Props {
  company: CompanyRef
  stock?: CompanyStock
  /** The grade and item being entered now; that row is marked. */
  selected?: { grade?: Grade; item?: string }
  /** Hide the company name (when the page already shows it). */
  bare?: boolean
}

/** How much of each item is there to sell right now, per grade. */
export default function SaleableStock({ company, stock, selected, bare }: Props) {
  if (!stock) return <Skeleton active paragraph={{ rows: 3 }} />
  const groups = GROUPS.map((g) => ({ ...g, lines: activeLines(stock[g.section]) })).filter((g) => g.lines.length)

  return (
    <div>
      {!bare && (
        <div className="strong" style={{ fontSize: 15, marginBottom: 4 }}>
          {company.name}
        </div>
      )}
      {!groups.length && <div className="muted" style={{ fontSize: 13, padding: '6px 0' }}>No stock to sell right now.</div>}
      {groups.map((g) => (
        <div key={g.grade} style={{ marginTop: 10 }}>
          <div className="faint" style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {gradeInfo(g.grade).name} · {g.title}
          </div>
          {g.lines.map((l) => (
            <Row key={l.item} line={l} active={selected?.grade === g.grade && selected.item === l.item} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Row({ line, active }: { line: StockLine; active: boolean }) {
  const qty = line.provisional.balance
  return (
    <div className="mat-row" style={active ? { background: '#eef4fb', borderRadius: 8, padding: '7px 8px', margin: '0 -8px' } : undefined}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: active ? 700 : undefined }}>
        <span className="legend-dot" style={{ background: color(line.item) }} />
        {itemName(line.item)}
      </span>
      <b className="num" style={{ color: qty <= 0 ? '#D4380D' : undefined }}>
        {formatQty(qty, line.unit)}
      </b>
    </div>
  )
}
