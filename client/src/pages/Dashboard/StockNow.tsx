import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Segmented, Skeleton } from 'antd'
import dayjs from 'dayjs'
import { ChartFrame, HeatmapChart } from '../../charts'
import { CompanyBadge } from '../../components/CompanyCards'
import { HintButton, SectionTitle } from '../../components/ui'
import { companyItems, itemName, toKg, itemColor } from '../../data/catalog'
import { avgRate, type TradeView } from '../../hooks/queries/reports'
import { useCompanyData } from '../../hooks/useCompanyData'
import type { Company } from '../../types/auth'
import type { CompanyStock, CompanySummary, StockLine } from '../../types/entries'
import { formatINRShort, formatQty, formatKg } from '../../utils/format'
import { activeLines, totalOf } from '../../utils/stock'

const dot = (item: string) => <span className="legend-dot" style={{ background: itemColor(item) }} />

/** Average rate per item in a trade view (amount ÷ quantity). */
const ratesOf = (view: TradeView | null) => new Map((view?.items ?? []).map((i) => [i.item, avgRate(i.amount, i.qty) ?? 0]))

/** Days in the period so far: presets end today, a custom range may end earlier. */
const daysIn = ([from, to]: [string, string]) => Math.max(1, dayjs(to).isAfter(dayjs()) ? dayjs().diff(dayjs(from), 'day') + 1 : dayjs(to).diff(dayjs(from), 'day') + 1)

/** "lasts ≈ 12 days" at the period's pace, or nothing when there was no use. */
const cover = (stock: number, used: number, days: number) => {
  if (stock <= 0 || used <= 0) return null
  const d = stock / (used / days)
  return d >= 365 ? 'lasts 1 year +' : `lasts ≈ ${Math.round(d)} days`
}

interface Rates {
  buy: Map<string, number>
  sell: Map<string, number>
}

function Row({ line, hint, value }: { line: StockLine; hint?: string | null; value?: number }) {
  const qty = line.provisional.balance
  return (
    <div className="stock-row">
      <span className="stock-name">
        {dot(line.item)}
        {itemName(line.item)}
      </span>
      <span className="stock-qty">
        <b className="num" style={{ color: qty < 0 ? '#D4380D' : undefined }}>
          {formatQty(qty, line.unit)}
        </b>
        <span className="faint num">
          {[hint, value ? `≈ ${formatINRShort(value)}` : null].filter(Boolean).join(' · ')}
        </span>
      </span>
    </div>
  )
}

function Group({ title, lines, empty, children }: { title: string; lines: StockLine[]; empty: string; children: (l: StockLine) => React.ReactNode }) {
  return (
    <div className="stock-group">
      <div className="stock-group-title">{title}</div>
      {lines.length ? lines.map(children) : <div className="faint" style={{ fontSize: 12.5, padding: '4px 0' }}>{empty}</div>}
    </div>
  )
}

function CompanyStockCard({ company, stock, summary, days, rates }: { company: Company; stock?: CompanyStock; summary?: CompanySummary; days: number; rates: Rates | null }) {
  const navigate = useNavigate()
  if (!stock) return <div className="surface" style={{ padding: 18 }}><Skeleton active paragraph={{ rows: 4 }} /></div>
  const items = companyItems(company)
  const ownInputs = new Set(items.inputs.map((i) => i.id))
  const raw = stock.raw.filter((l) => ownInputs.has(l.item) || l.provisional.balance)
  const ready = stock.output.filter((l) => l.provisional.balance || l.provisional.in_qty)
  const resale = activeLines(stock.resale)
  const rawKg = totalOf(stock.raw)
  const processed = summary?.production.processed_kg ?? 0
  const soldQty = (item: string) => summary?.sales.by_item.find((i) => i.item === item)?.qty ?? 0
  const value = (lines: StockLine[], by: Map<string, number> | undefined) => lines.reduce((s, l) => s + Math.max(l.provisional.balance, 0) * (by?.get(l.item) ?? 0), 0)
  const readyValue = value(ready, rates?.sell)
  return (
    <div className="surface stock-card fade-in" onClick={() => navigate(`/companies/${company.id}`)}>
      <header className="stock-card-head">
        <CompanyBadge code={company.code} size={34} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="strong" style={{ fontSize: 15 }}>{company.name}</div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            {formatKg(rawKg)} raw material{cover(rawKg, processed, days) ? ` · ${cover(rawKg, processed, days)}` : ''}
            {stock.check_overdue && <b style={{ color: '#D4380D' }}> · stock check due</b>}
          </div>
        </div>
        {rates && readyValue > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div className="strong num" style={{ fontSize: 15 }}>≈ {formatINRShort(readyValue)}</div>
            <div className="faint" style={{ fontSize: 11.5 }}>value of ready stock</div>
          </div>
        )}
      </header>
      <div className="stock-cols">
        <Group title="Raw material" lines={raw} empty="No raw material">
          {(l) => <Row key={l.item} line={l} value={rates ? Math.max(l.provisional.balance, 0) * (rates.buy.get(l.item) ?? 0) : undefined} />}
        </Group>
        <Group title="Ready to sell" lines={ready} empty="Nothing made yet">
          {(l) => <Row key={l.item} line={l} hint={cover(l.provisional.balance, soldQty(l.item), days)} value={rates ? Math.max(l.provisional.balance, 0) * (rates.sell.get(l.item) ?? 0) : undefined} />}
        </Group>
        {resale.length > 0 && (
          <Group title="Grade B" lines={resale} empty="">
            {(l) => <Row key={l.item} line={l} />}
          </Group>
        )}
      </div>
    </div>
  )
}

/**
 * The first thing on the dashboard: raw material and ready-to-sell stock in every company,
 * as of now. Days of cover use the pace of the period picked; values use its average rates.
 */
export default function StockNow({ purchases, sales }: { purchases: TradeView | null; sales: TradeView | null }) {
  const navigate = useNavigate()
  const { scope, range, stocks, summaries, raw, output, resale, isLoading } = useCompanyData()
  const [compare, setCompare] = useState<'raw' | 'output'>('raw')
  const companies = scope.filter((c) => stocks.has(c.id) || isLoading)
  const several = companies.length > 1
  const days = daysIn(range)
  const rates: Rates | null = purchases || sales ? { buy: ratesOf(purchases), sell: ratesOf(sales) } : null

  const readyKg = output.reduce((s, l) => s + (l.unit === 'kg' ? Math.max(l.provisional.balance, 0) : 0), 0)
  const readyL = totalOf(output, 'provisional', 'L')
  const readyValue = output.reduce((s, l) => s + Math.max(l.provisional.balance, 0) * (rates?.sell.get(l.item) ?? 0), 0)
  const rawValue = raw.reduce((s, l) => s + Math.max(l.provisional.balance, 0) * (rates?.buy.get(l.item) ?? 0), 0)
  const resaleKg = totalOf(resale)

  // Company × item grid, for comparing companies at a glance.
  const section = compare === 'raw' ? 'raw' : 'output'
  const columns = [...new Set(companies.flatMap((c) => (compare === 'raw' ? companyItems(c).inputs : companyItems(c).products).map((i) => i.id)))]
  const cells = companies.flatMap((c) =>
    columns.map((id) => {
      const l = stocks.get(c.id)?.[section].find((x) => x.item === id)
      return { x: itemName(id), y: c.name, value: Math.max(toKg(id, l?.provisional.balance ?? 0), 0), id: c.id }
    }),
  )

  return (
    <>
      <SectionTitle
        title="Stock right now"
        hint="today"
        extra={
          <HintButton title="How stock is counted">
            <p>Only entries the Manager has approved are counted. Entries still waiting for the Manager are not in stock yet.</p>
            <p>Stock is for today. The dates at the top do not change it.</p>
            {rates && <p>Values (≈) use this period's average buying rate for raw material and selling rate for products.</p>}
            <p>"Lasts" is how many days the stock will last at this period's pace.</p>
          </HintButton>
        }
      />
      <div className="grid grid-3">
        {(
          [
            ['Raw material', formatKg(totalOf(raw)), rates && rawValue ? `worth ≈ ${formatINRShort(rawValue)}` : 'for production'],
            ['Ready to sell', formatKg(readyKg), [readyL ? `+ ${formatQty(readyL, 'L')} oil` : null, rates && readyValue ? `worth ≈ ${formatINRShort(readyValue)}` : null].filter(Boolean).join(' · ') || 'made in the plant'],
            ['Grade B stock', formatKg(resaleKg), 'raw material'],
          ] as const
        ).map(([label, value, sub]) => (
          <div key={label} className="surface stat-tile">
            <div className="label">{label}</div>
            <div className="value num">{value}</div>
            <div className="sub">{sub}</div>
          </div>
        ))}
      </div>

      <div className={`grid ${several ? 'grid-2' : ''}`} style={{ marginTop: 12 }}>
        {companies.map((c) => (
          <CompanyStockCard key={c.id} company={c} stock={stocks.get(c.id)} summary={summaries.get(c.id)} days={days} rates={rates} />
        ))}
      </div>

      {several && (
        <div className="viz-grid">
          <ChartFrame
            title="Compare companies"
            sub="Stock now, by weight · darker = more · click a box to open the company"
            extra={<Segmented size="small" value={compare} onChange={setCompare} options={[{ value: 'raw', label: 'Raw material' }, { value: 'output', label: 'Ready to sell' }]} />}
            loading={isLoading}
            height={Math.min(companies.length * 34 + 64, 300)}
            empty={cells.every((x) => !x.value)}
            emptyText="No stock"
            table={{ columns: ['Company', ...columns.map(itemName)], rows: companies.map((c) => [c.name, ...columns.map((id) => formatKg(cells.find((x) => x.y === c.name && x.x === itemName(id))?.value ?? 0))]) }}
          >
            <HeatmapChart cells={cells} columns={columns.map(itemName)} rows={companies.map((c) => c.name)} format={formatKg} onSelect={(cell) => navigate(`/companies/${cell.id}`)} />
          </ChartFrame>
        </div>
      )}
    </>
  )
}
