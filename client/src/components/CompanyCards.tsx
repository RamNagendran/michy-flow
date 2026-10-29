import { useNavigate } from 'react-router-dom'
import { Skeleton, Tooltip } from 'antd'
import { FunctionOutlined, RightOutlined } from '@ant-design/icons'
import { seriesColors } from '../styles/theme'
import { itemName, processOf } from '../data/catalog'
import type { CompanyRef } from '../types/auth'
import type { CompanySummary, StockLine } from '../types/entries'
import { formatKg, formatQty } from '../utils/format'
import { activeLines, totalOf } from '../utils/stock'
import { StockBar } from './ui'

const color = (item: string) => seriesColors[item as keyof typeof seriesColors] ?? '#8a919e'

/** "1,240 kg" (or litres for oil) with the finalised figure underneath when the two differ. */
export function StockFigure({ line }: { line: Pick<StockLine, 'provisional' | 'confirmed' | 'unit'> }) {
  const pending = line.provisional.balance !== line.confirmed.balance
  return (
    <span className="num" style={{ textAlign: 'right', display: 'inline-block' }}>
      <b>{formatQty(line.provisional.balance, line.unit)}</b>
      {pending && (
        <Tooltip title="Only entries checked by Finance">
          <div className="faint" style={{ fontSize: 11.5 }}>
            {formatQty(line.confirmed.balance, line.unit)} finalised
          </div>
        </Tooltip>
      )}
    </span>
  )
}

function Rows({ lines }: { lines: StockLine[] }) {
  if (!lines.length) return <div className="faint" style={{ fontSize: 13, padding: '6px 0' }}>Nothing yet</div>
  return (
    <div style={{ marginTop: 10 }}>
      {lines.map((l) => (
        <div className="mat-row" key={l.item} style={{ alignItems: 'flex-start' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="legend-dot" style={{ background: color(l.item) }} />
            {itemName(l.item)}
          </span>
          <StockFigure line={l} />
        </div>
      ))}
    </div>
  )
}

const Caption = ({ children }: { children: string }) => (
  <div className="faint" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '16px 0 4px' }}>
    {children}
  </div>
)

export function CompanyBadge({ code, size = 42 }: { code: string; size?: number }) {
  return (
    <span className="loc-badge fa" style={size === 42 ? undefined : { width: size, height: size, fontSize: Math.round(size * 0.42), borderRadius: Math.round(size / 3.5) }}>
      {code.slice(0, 3)}
    </span>
  )
}

interface CardProps {
  company: CompanyRef
  raw?: StockLine[]
  output?: StockLine[]
  summary?: CompanySummary
}

/** One company: its type, Grade A raw stock, output ready to sell, and what it processed. */
export function CompanyCard({ company, raw, output, summary }: CardProps) {
  const navigate = useNavigate()
  if (!raw || !output) return <div className="surface loc-card"><Skeleton active /></div>
  const rawLines = activeLines(raw)
  return (
    <div className="surface loc-card fade-in" onClick={() => navigate(`/companies/${company.id}`)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CompanyBadge code={company.code} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="strong" style={{ fontSize: 15 }}>
            {company.name}
          </div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            {[processOf(company.category).name, company.city, summary && `${summary.production.count} runs`].filter(Boolean).join(' · ')}
          </div>
        </div>
        <RightOutlined className="faint" />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16, gap: 10 }}>
        {(
          [
            ['Raw material in stock', totalOf(raw)],
            ['Processed', summary?.production.input_kg],
          ] as [string, number | undefined][]
        ).map(([label, kg]) => (
          <div key={label} style={{ background: '#f7f8fa', borderRadius: 10, padding: '10px 12px' }}>
            <div className="faint" style={{ fontSize: 12, fontWeight: 700 }}>
              {label}
            </div>
            <div className="num strong" style={{ fontSize: 17 }}>
              {kg === undefined ? '—' : formatKg(kg)}
            </div>
          </div>
        ))}
      </div>

      <Caption>Raw material · Grade A</Caption>
      <StockBar parts={rawLines.map((l) => ({ key: itemName(l.item), value: l.provisional.balance, color: color(l.item) }))} />
      <Rows lines={rawLines} />
      <Caption>Ready to sell</Caption>
      <Rows lines={activeLines(output)} />
    </div>
  )
}

/** All companies in view added together. Shown only when more than one company is in view. */
export function CompaniesTotalCard({ count, raw, output, producedKg }: { count: number; raw: StockLine[]; output: StockLine[]; producedKg?: number }) {
  const rawLines = activeLines(raw)
  const rawSum = totalOf(raw)
  return (
    <div className="surface loc-card total-card fade-in" style={{ cursor: 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="loc-badge total" style={{ background: '#D82E54' }}>
          <FunctionOutlined />
        </div>
        <div>
          <div className="strong" style={{ fontSize: 15 }}>
            All companies
          </div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            {count} companies added together
          </div>
        </div>
      </div>
      <div style={{ marginTop: 18, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="num strong" style={{ fontSize: 24, letterSpacing: '-0.02em' }}>
          {formatKg(rawSum)}
        </span>
      </div>
      <div className="faint" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Grade A raw material in stock{producedKg !== undefined && ` · ${formatKg(producedKg)} produced this period`}
      </div>
      <StockBar parts={rawLines.map((l) => ({ key: itemName(l.item), value: l.provisional.balance, color: color(l.item) }))} />
      <Rows lines={rawLines} />
      <Caption>Ready to sell</Caption>
      <Rows lines={activeLines(output)} />
      <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
        A simple sum. Each company keeps its own stock — nothing is shared or transferred.
      </div>
    </div>
  )
}
