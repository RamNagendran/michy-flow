import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Segmented, Select, Table, Tag, Tooltip } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  BarChart,
  ChartFrame,
  DonutChart,
  flowColors,
  gradeColor,
  LineChart,
  OTHERS_COLOR,
  partyColors,
  productColor,
  RangeBarChart,
  RangeTrendChart,
  ScatterChart,
  StackedBarChart,
  StackedColumnChart,
  type ScatterGroup,
} from '../../charts'
import { HintButton, SectionTitle } from '../../components/ui'
import { itemName, itemsOfCompanies, type Unit } from '../../data/catalog'
import { avgRate, useTradeAnalysis, type PartyRow, type TradeView } from '../../hooks/queries/reports'
import { useAccess } from '../../hooks/useAccess'
import type { ChartGrouping as Grouping } from '../../hooks/useChartGrouping'
import { usePeriod } from '../../hooks/usePeriod'
import type { Grade } from '../../types/entries'
import type { Bucket, TradeSide } from '../../types/reports'
import { formatDate, formatINR, formatINRShort, formatPercent, formatQty, formatRateIn, formatKg } from '../../utils/format'
import { BUCKET_MAX_DAYS, bucketLabels, periodLabel, rangeSubtitle, type DateRange } from '../../utils/period'

/** Words for each side, so one screen serves purchases and sales. */
const WORDS = {
  purchase: { title: 'Purchases', party: 'Supplier', parties: 'Suppliers', item: 'Material', items: 'materials', money: 'Spent', verb: 'bought', color: flowColors.purchase },
  sale: { title: 'Sales', party: 'Buyer', parties: 'Buyers', item: 'Product', items: 'products', money: 'Received', verb: 'sold', color: flowColors.sales },
} as const

const TOP_PARTIES = partyColors.length
const TOP_ITEMS = 6
const OTHERS = 'Others'

/** Change against the previous period of the same length. `upIsGood` colours it. */
function Change({ now, before, upIsGood }: { now: number; before: number; upIsGood?: boolean }) {
  if (!before) return <span className="change-flat">{now ? 'nothing in the period before' : ''}</span>
  const pct = ((now - before) / before) * 100
  if (Math.abs(pct) < 0.05) return <span className="change-flat">same as before</span>
  const up = pct > 0
  const tone = upIsGood === undefined ? 'change-flat' : up === upIsGood ? 'change-good' : 'change-bad'
  return (
    <span className={tone}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {formatPercent(Math.abs(pct))} vs before
    </span>
  )
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="surface stat-tile">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

const qtyText = (kg: number, litres: number) => [kg ? formatKg(kg) : null, litres ? formatQty(litres, 'L') : null].filter(Boolean).join(' + ') || formatKg(0)

/** Top parties keep their own colour (biggest first); the rest share "Others". */
function partyPalette(parties: PartyRow[]) {
  return new Map(parties.slice(0, TOP_PARTIES).map((p, i) => [p.key, partyColors[i]]))
}

interface Filters {
  range: DateRange
  bucket: Bucket
  item?: string
  grades: Grade[]
  partyKeys: string[]
}



function useFilters(grouping: Grouping) {
  const { range } = usePeriod()
  const [item, setItem] = useState<string>()
  const [grades, setGrades] = useState<Grade[]>(['A', 'B'])
  const [partyKeys, setParties] = useState<string[]>([])
  const reset = () => {
    grouping.reset()
    setItem(undefined)
    setGrades(['A', 'B'])
    setParties([])
  }
  const changed = grouping.picked || !!item || grades.join() !== 'A,B' || partyKeys.length > 0
  return { filters: { range, bucket: grouping.bucket, item, grades, partyKeys } as Filters, changed, setItem, setGrades, setParties, reset }
}

/** Height of the app's sticky top bar (theme Layout.headerHeight). */
const TOPBAR_PX = 56

/** True once the sticky filter bar has reached the top bar, so it can show a shadow. */
function useStuck() {
  const sentinel = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < TOPBAR_PX + 1), { rootMargin: `-${TOPBAR_PX + 1}px 0px 0px 0px` })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { sentinel, stuck }
}

function AnalysisHint() {
  return (
    <HintButton title="Buying and selling analysis">
      <h4>Filters</h4>
      <p>The bar stays at the top while you scroll. Every chart and table under it follows it.</p>
      <ul>
        <li><b>Purchases / Sales:</b> what we bought, or what we sold.</li>
        <li><b>Dates:</b> picked once, in the top bar of the screen (Month, Quarter, Year or Custom, up to 10 years).</li>
        <li><b>Chart by:</b> how the charts split those dates: one point per day, week, month or year. The production charts below follow it too. Long ranges cannot be shown daily.</li>
        <li><b>Material or product:</b> pick one to see its rates, each party's price range and every bill.</li>
        <li><b>Grade:</b> A and B are real goods. Grade C is bill only, so it is off at first; its rates are not real prices.</li>
        <li><b>Supplier or buyer:</b> only when one company is open.</li>
      </ul>
      <h4>Rates</h4>
      <div className="formula">Average rate = Total amount ÷ Total quantity</div>
      <p>So a big bill counts more than a small one. Lowest and highest are single bills.</p>
      <h4>"vs before"</h4>
      <p>Compared with the same number of days just before the dates picked. For purchases, a rate going up is red. For sales, a rate going up is green.</p>
      <h4>Which entries count</h4>
      <p>All saved entries, also those waiting for approval. Rejected and deleted entries do not count.</p>
    </HintButton>
  )
}

/**
 * Purchases or sales analysed: amounts, rates, suppliers or buyers over time, with a filter bar
 * that sticks while scrolling. `children` (the production charts) sit under the same bar.
 */
export default function TradeAnalysis({ grouping, children }: { grouping: Grouping; children?: ReactNode }) {
  const { scope, can } = useAccess()
  const companies = useMemo(() => scope.filter((c) => can('view_finance', c.id)), [scope, can])
  const [side, setSide] = useState<TradeSide>('purchase')
  const f = useFilters(grouping)
  const { sentinel, stuck } = useStuck()
  const w = WORDS[side]
  const ids = companies.map((c) => c.id)
  const base = { side, range: f.filters.range, bucket: f.filters.bucket, item: f.filters.item, grades: f.filters.grades }
  // Unfiltered by party: the party list, colours and shares stay put while parties are picked.
  const all = useTradeAnalysis(ids, base)
  const single = companies.length === 1
  const partyIds = single ? (all.view?.parties.filter((p) => f.filters.partyKeys.includes(p.key)).map((p) => p.party_id) ?? []) : []
  const picked = useTradeAnalysis(ids, { ...base, partyIds })
  const q = partyIds.length ? picked : all
  const v = q.view
  const colors = useMemo(() => partyPalette(all.view?.parties ?? []), [all.view])

  const catalogItems = (side === 'purchase' ? itemsOfCompanies(companies, 'inputs') : [...itemsOfCompanies(companies, 'products'), ...itemsOfCompanies(companies, 'inputs')]).map((i) => i.id)
  const itemChoices = [...new Set([...catalogItems, ...(all.view?.items.map((i) => i.item) ?? [])])]
  const days = dayjs(f.filters.range[1]).diff(dayjs(f.filters.range[0]), 'day')

  if (!companies.length) return <>{children}</>

  const pickSide = (next: TradeSide) => {
    setSide(next)
    f.setItem(undefined)
    f.setParties([])
  }

  return (
    <section className="trade-analysis">
      <SectionTitle
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            Buying and selling analysis <AnalysisHint />
          </span>
        }
      />

      {/* Sticks under the top bar while scrolling through this section, so filters are always at hand. */}
      <div ref={sentinel} aria-hidden style={{ height: 1 }} />
      <div className={`surface filter-bar sticky-filters${stuck ? ' is-stuck' : ''}`}>
        <Segmented<TradeSide> value={side} onChange={pickSide} options={[{ value: 'purchase', label: 'Purchases' }, { value: 'sale', label: 'Sales' }]} />
        <span className="filter-divider" />
        <Tooltip title="Change the dates in the top bar of the screen">
          <span className="filter-dates num">{rangeSubtitle(f.filters.range)}</span>
        </Tooltip>
        <span className="filter-label">Chart by</span>
        <Segmented<Bucket>
          value={grouping.bucket}
          onChange={grouping.setBucket}
          options={(['day', 'week', 'month', 'year'] as const).map((b) => ({
            value: b,
            disabled: !grouping.allowed.includes(b),
            label: grouping.allowed.includes(b) ? bucketLabels[b] : <Tooltip title={`Only for up to ${BUCKET_MAX_DAYS[b]} days`}>{bucketLabels[b]}</Tooltip>,
          }))}
        />
        <Select
          prefix={<span className="filter-label">{w.item}</span>}
          style={{ width: 230 }}
          value={f.filters.item ?? ''}
          onChange={(i) => f.setItem(i || undefined)}
          options={[{ value: '', label: `All ${w.items}` }, ...itemChoices.map((i) => ({ value: i, label: itemName(i) }))]}
        />
        <Select<Grade[]>
          mode="multiple"
          prefix={<span className="filter-label">Grade</span>}
          maxTagCount="responsive"
          style={{ width: 200 }}
          value={f.filters.grades}
          onChange={(g) => g.length && f.setGrades(g)}
          options={(['A', 'B', 'C'] as const).map((g) => ({ value: g, label: g }))}
        />
        {single && (
          <Select
            mode="multiple"
            allowClear
            prefix={<span className="filter-label">{w.party}</span>}
            maxTagCount="responsive"
            style={{ width: 240 }}
            placeholder="All"
            value={f.filters.partyKeys}
            onChange={f.setParties}
            optionFilterProp="label"
            options={(all.view?.parties ?? []).map((p) => ({ value: p.key, label: p.name }))}
          />
        )}
        {f.changed && (
          <Button type="text" icon={<ReloadOutlined />} onClick={f.reset}>
            Reset
          </Button>
        )}
      </div>

      <Overview view={v} side={side} loading={q.isLoading} />
      <Charts view={v} side={side} colors={colors} loading={q.isLoading} refreshing={q.isRefreshing} days={days} onPickItem={f.setItem} itemChoices={(all.view?.items ?? []).map((i) => i.item)} />
      <PartyTable view={v} side={side} loading={q.isLoading} refreshing={q.isRefreshing} onPick={single ? (key) => f.setParties(f.filters.partyKeys.includes(key) ? f.filters.partyKeys.filter((k) => k !== key) : [...f.filters.partyKeys, key]) : undefined} picked={f.filters.partyKeys} />
      {children}
    </section>
  )
}

function Overview({ view: v, side, loading }: { view: TradeView | null; side: TradeSide; loading: boolean }) {
  const w = WORDS[side]
  if (loading && !v) return <div className="grid grid-4">{[0, 1, 2, 3].map((i) => <Tile key={i} label="…" value="—" />)}</div>
  if (!v) return null
  const t = v.totals
  const p = v.previous
  const unit = v.unit as Unit | null
  const qty = unit ? (unit === 'L' ? t.qty_l : t.qty_kg) : 0
  const prevQty = unit ? (unit === 'L' ? p.qty_l : p.qty_kg) : 0
  const rate = unit ? avgRate(t.amount, qty) : null
  const prevRate = unit ? avgRate(p.amount, prevQty) : null
  const top = v.parties[0]
  const topShare = top && t.amount ? (top.amount / t.amount) * 100 : 0
  const before = `${dayjs(v.previous_from).format('D MMM YY')} – ${dayjs(v.previous_to).format('D MMM YY')}`
  return (
    <div className="grid grid-4">
      <Tile label={`${w.money}`} value={formatINRShort(t.amount)} sub={<Tooltip title={`Before: ${before} · ${formatINRShort(p.amount)}`}><span><Change now={t.amount} before={p.amount} upIsGood={side === 'sale'} /></span></Tooltip>} />
      <Tile
        label={`Quantity ${w.verb}`}
        value={unit ? formatQty(qty, unit) : qtyText(t.qty_kg, t.qty_l)}
        sub={<>{t.bills} bills · {formatINRShort(t.bills ? t.amount / t.bills : 0)} a bill · <Change now={unit ? qty : t.qty_kg + t.qty_l} before={unit ? prevQty : p.qty_kg + p.qty_l} /></>}
      />
      {unit ? (
        <Tile
          label="Average rate"
          value={rate === null ? '—' : formatRateIn(rate, unit)}
          sub={rate !== null && prevRate !== null ? <Tooltip title={`Before: ${formatRateIn(prevRate, unit)}`}><span><Change now={rate} before={prevRate} upIsGood={side === 'sale'} /></span></Tooltip> : 'weighted by quantity'}
        />
      ) : (
        <Tile label={`${w.items}`} value={v.items.length} sub={v.items[0] ? `Most: ${itemName(v.items[0].item)} · ${formatPercent(t.amount ? (v.items[0].amount / t.amount) * 100 : 0, 0)}` : 'pick one to see its rate'} />
      )}
      <Tile
        label={w.parties}
        value={t.parties}
        sub={
          top ? (
            <Tooltip title={`How much of the money went to the biggest ${w.party.toLowerCase()}. Above 50% means we depend on one party.`}>
              <span style={{ color: topShare > 50 ? '#D4380D' : undefined }}>
                Biggest: {top.name} · {formatPercent(topShare, 0)}
              </span>
            </Tooltip>
          ) : (
            `was ${p.parties} before`
          )
        }
      />
    </div>
  )
}

function Charts({
  view: v,
  side,
  colors,
  loading,
  refreshing,
  days,
  itemChoices,
  onPickItem,
}: {
  view: TradeView | null
  side: TradeSide
  colors: Map<string, string>
  loading: boolean
  refreshing: boolean
  days: number
  itemChoices: string[]
  onPickItem: (item: string) => void
}) {
  const w = WORDS[side]
  const bucket = v?.bucket ?? 'month'
  const unit = (v?.unit ?? 'kg') as Unit
  const rate = (x: number) => formatRateIn(x, unit)
  const label = (p: string) => periodLabel(p, bucket)
  const every = bucketLabels[bucket].toLowerCase()
  const frame = { loading: loading && !v, refreshing }

  // Amount per period, split by item (biggest items; the rest as "Others").
  const topItems = (v?.items ?? []).slice(0, TOP_ITEMS).map((i) => i.item)
  const itemRows = (v?.series ?? []).map((p) => {
    const row: Record<string, string | number> = { label: label(p.period) }
    for (const s of v!.itemSeries.filter((x) => x.period === p.period)) {
      const k = topItems.includes(s.item) ? s.item : OTHERS
      row[k] = Number(row[k] ?? 0) + s.amount
    }
    return row
  })
  const itemSeriesSpec = [...topItems.map((i) => ({ field: i, name: itemName(i), color: productColor(i) })), ...((v?.items.length ?? 0) > TOP_ITEMS ? [{ field: OTHERS, name: OTHERS, color: OTHERS_COLOR }] : [])]
  const mix = (v?.items ?? []).slice(0, TOP_ITEMS).map((i) => ({ label: itemName(i.item), value: i.amount, color: productColor(i.item) }))

  // Rates over time: one line per item (kg items, so rate per kg is one scale), or the chosen item's range.
  const kgItems = (v?.items ?? []).filter((i) => i.unit === 'kg').slice(0, TOP_ITEMS)
  const litreItems = (v?.items ?? []).filter((i) => i.unit === 'L')
  const rateRows = (v?.series ?? []).map((p) => {
    const row: Record<string, string | number | null> = { label: label(p.period) }
    for (const i of kgItems) {
      const s = v!.itemSeries.find((x) => x.period === p.period && x.item === i.item)
      row[i.item] = s ? avgRate(s.amount, s.qty) : null
    }
    return row
  })
  const band = (v?.series ?? []).map((p) => {
    const s = v!.itemSeries.find((x) => x.period === p.period)
    return { label: label(p.period), low: s?.min_rate ?? null, high: s?.max_rate ?? null, avg: s ? avgRate(s.amount, s.qty) : null }
  })
  const rateValues = rateRows.flatMap((r) => kgItems.map((i) => r[i.item])).filter((x): x is number => typeof x === 'number')

  // Parties: the biggest keep a colour; the rest are "Others".
  const parties = v?.parties ?? []
  const shown = parties.filter((p) => colors.has(p.key))
  const colorOf = (key: string) => colors.get(key) ?? OTHERS_COLOR
  const partyAmountRows = (v?.series ?? []).map((p) => {
    const row: Record<string, string | number> = { label: label(p.period) }
    for (const s of v!.partySeries.filter((x) => x.period === p.period)) {
      const k = colors.has(s.key) ? s.key : OTHERS
      row[k] = Number(row[k] ?? 0) + s.amount
    }
    return row
  })
  const hasOthers = parties.some((p) => !colors.has(p.key))
  const partySpec = [...shown.map((p) => ({ field: p.key, name: p.name, color: colorOf(p.key) })), ...(hasOthers ? [{ field: OTHERS, name: OTHERS, color: OTHERS_COLOR }] : [])]
  const partyRateRows = (v?.series ?? []).map((p) => {
    const row: Record<string, string | number | null> = { label: label(p.period) }
    for (const party of shown) {
      const s = v!.partySeries.find((x) => x.period === p.period && x.key === party.key)
      row[party.key] = s ? avgRate(s.amount, s.qty) : null
    }
    return row
  })
  const partyRateValues = partyRateRows.flatMap((r) => shown.map((p) => r[p.key])).filter((x): x is number => typeof x === 'number')
  const partyQty = (p: PartyRow) => (unit === 'L' ? p.qty_l : p.qty_kg)
  const overall = v?.item ? avgRate(v.totals.amount, unit === 'L' ? v.totals.qty_l : v.totals.qty_kg) : null
  const ranges = parties
    .filter((p) => p.min_rate !== null && p.max_rate !== null && partyQty(p))
    .slice(0, 20)
    .map((p) => ({ name: p.name, low: p.min_rate!, high: p.max_rate!, avg: p.amount / partyQty(p), color: colorOf(p.key), note: `${p.bills} bills · ${formatQty(partyQty(p), unit)}` }))
  const ranking = parties.slice(0, 12).map((p) => ({ name: p.name, amount: p.amount }))
  const scatter: ScatterGroup[] = [
    ...shown.map((p) => ({ name: p.name, color: colorOf(p.key), points: (v?.bills ?? []).filter((b) => b.key === p.key) })),
    { name: OTHERS, color: OTHERS_COLOR, points: (v?.bills ?? []).filter((b) => !colors.has(b.key)) },
  ]
    .filter((g) => g.points.length)
    .map((g) => ({ ...g, points: g.points.map((b) => ({ date: b.entry_date, value: b.rate, size: b.qty, note: `${b.ref_no} · ${formatQty(b.qty, unit)}` })) }))

  const grades = v?.grades ?? []
  const gradeRow = [{ flow: w.title, ...Object.fromEntries(grades.map((g) => [g.grade, g.amount])) }]
  const minOf = (xs: number[]) => (xs.length ? Math.floor(Math.min(...xs) * 0.9) : 0)

  return (
    <>
      <div className="viz-grid wide-left">
        <ChartFrame
          title={`${w.money} · ${every}`}
          sub={`by ${w.item.toLowerCase()} · invoice value`}
          {...frame}
          empty={!v?.totals.amount}
          height={240}
          table={{ columns: ['Period', ...itemSeriesSpec.map((s) => s.name), 'Total'], rows: itemRows.map((r) => [String(r.label), ...itemSeriesSpec.map((s) => formatINRShort(Number(r[s.field] ?? 0))), formatINRShort(itemSeriesSpec.reduce((n, s) => n + Number(r[s.field] ?? 0), 0))]) }}
        >
          <StackedColumnChart data={itemRows} categoryField="label" series={itemSeriesSpec} format={formatINRShort} scrollFrom="end" height={240} />
        </ChartFrame>
        <ChartFrame title={`Share by ${w.item.toLowerCase()}`} sub="of the money" {...frame} empty={!mix.length} height={240} table={{ columns: [w.item, 'Amount'], rows: mix.map((m) => [m.label, formatINRShort(m.value)]) }}>
          <DonutChart slices={mix} format={formatINRShort} centerValue={formatINRShort(v?.totals.amount ?? 0)} centerLabel={w.money.toLowerCase()} height={240} />
        </ChartFrame>
      </div>

      <div className="viz-grid cols-2">
        {v?.item ? (
          <ChartFrame
            title={`${itemName(v.item)} · rate ${every}`}
            sub="line = average · bar = lowest to highest bill"
            {...frame}
            empty={band.every((b) => b.avg === null)}
            height={240}
            table={{ columns: ['Period', 'Average', 'Lowest', 'Highest'], rows: band.map((b) => [b.label, b.avg === null ? '—' : rate(b.avg), b.low === null ? '—' : rate(b.low), b.high === null ? '—' : rate(b.high)]) }}
          >
            <RangeTrendChart data={band} color={productColor(v.item)} format={rate} height={240} />
          </ChartFrame>
        ) : (
          <ChartFrame
            title={`Rate of each ${w.item.toLowerCase()} · ${every}`}
            sub={`average rate per kg${litreItems.length ? ` · for ${litreItems.map((i) => itemName(i.item)).join(', ')} (rate per litre), pick it above` : ''}`}
            {...frame}
            empty={!rateValues.length}
            height={240}
            table={{ columns: ['Period', ...kgItems.map((i) => itemName(i.item))], rows: rateRows.map((r) => [String(r.label), ...kgItems.map((i) => (typeof r[i.item] === 'number' ? formatRateIn(r[i.item] as number, 'kg') : '—'))]) }}
          >
            <LineChart data={rateRows} categoryField="label" series={kgItems.map((i) => ({ field: i.item, name: itemName(i.item), color: productColor(i.item) }))} format={(x) => formatRateIn(x, 'kg')} min={minOf(rateValues)} height={240} />
          </ChartFrame>
        )}
        <ChartFrame title={`Top ${w.parties.toLowerCase()}`} sub="by invoice value" {...frame} empty={!ranking.length} height={240} table={{ columns: [w.party, 'Amount', 'Share'], rows: parties.map((p) => [p.name, formatINRShort(p.amount), formatPercent(v?.totals.amount ? (p.amount / v.totals.amount) * 100 : 0)]) }}>
          <BarChart data={ranking} categoryField="name" series={[{ field: 'amount', name: w.money, color: w.color }]} format={formatINRShort} height={240} />
        </ChartFrame>
      </div>

      {v?.item ? (
        <>
          <div className="viz-grid cols-2">
            <ChartFrame
              title={`${w.party} rates · ${every}`}
              sub={`each ${w.party.toLowerCase()}'s average for ${itemName(v.item)}`}
              {...frame}
              empty={!partyRateValues.length}
              height={260}
              table={{ columns: ['Period', ...shown.map((p) => p.name)], rows: partyRateRows.map((r) => [String(r.label), ...shown.map((p) => (typeof r[p.key] === 'number' ? rate(r[p.key] as number) : '—'))]) }}
            >
              <LineChart data={partyRateRows} categoryField="label" series={shown.map((p) => ({ field: p.key, name: p.name, color: colorOf(p.key) }))} format={rate} min={minOf(partyRateValues)} height={260} />
            </ChartFrame>
            <ChartFrame
              title={`${w.party} price range`}
              sub={`bar = lowest to highest bill · dot = their average${overall ? ` · dashed line = everyone (${rate(overall)})` : ''}`}
              {...frame}
              empty={!ranges.length}
              height={260}
              table={{ columns: [w.party, 'Average', 'Lowest', 'Highest'], rows: ranges.map((r) => [r.name, rate(r.avg), rate(r.low), rate(r.high)]) }}
            >
              <RangeBarChart rows={ranges} format={rate} reference={overall} height={260} />
            </ChartFrame>
          </div>
          <div className="viz-grid">
            <ChartFrame
              title={`Every bill · ${itemName(v.item)}`}
              sub={`one dot per bill · higher = costlier · bigger dot = more quantity${v.billsTruncated ? ' · latest 1,500 bills per company' : ''}`}
              {...frame}
              empty={!v.bills.length}
              height={280}
              table={{ columns: ['Date', 'Bill', w.party, 'Quantity', 'Rate'], rows: [...v.bills].reverse().slice(0, 300).map((b) => [formatDate(b.entry_date), b.ref_no, parties.find((p) => p.key === b.key)?.name ?? '—', formatQty(b.qty, unit), rate(b.rate)]) }}
            >
              <ScatterChart groups={scatter} format={rate} height={280} />
            </ChartFrame>
          </div>
        </>
      ) : (
        itemChoices.length > 0 && (
          <div className="surface pick-item">
            <span className="muted" style={{ fontSize: 13 }}>
              Pick one {w.item.toLowerCase()} to compare {w.parties.toLowerCase()}' rates, price ranges and every bill:
            </span>
            {itemChoices.map((i) => (
              <Button key={i} size="small" onClick={() => onPickItem(i)}>
                {itemName(i)}
              </Button>
            ))}
          </div>
        )
      )}

      <div className="viz-grid wide-left">
        <ChartFrame
          title={`${w.money} by ${w.party.toLowerCase()} · ${every}`}
          sub={`biggest ${shown.length} by colour${hasOthers ? ', the rest as Others' : ''}`}
          {...frame}
          empty={!v?.totals.amount}
          height={240}
          table={{ columns: ['Period', ...partySpec.map((s) => s.name)], rows: partyAmountRows.map((r) => [String(r.label), ...partySpec.map((s) => formatINRShort(Number(r[s.field] ?? 0)))]) }}
        >
          <StackedColumnChart data={partyAmountRows} categoryField="label" series={partySpec} format={formatINRShort} scrollFrom="end" height={240} />
        </ChartFrame>
        <ChartFrame
          title="Grade mix"
          sub="A: plant · B: re-sell · C: bill only (all grades, whatever the filter)"
          {...frame}
          empty={!grades.some((g) => g.amount)}
          height={240}
          table={{ columns: ['Grade', 'Bills', 'Quantity', 'Amount'], rows: grades.map((g) => [`Grade ${g.grade}`, g.bills, qtyText(g.qty_kg, g.qty_l), formatINRShort(g.amount)]) }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', gap: 12 }}>
            <StackedBarChart data={gradeRow} categoryField="flow" percent series={(['A', 'B', 'C'] as const).map((g) => ({ field: g, name: `Grade ${g}`, color: gradeColor[g] }))} format={formatINRShort} height={130} />
            <div className="faint" style={{ fontSize: 12, textAlign: 'center' }}>
              {days + 1} days · {grades.map((g) => `${g.grade}: ${formatINRShort(g.amount)}`).join(' · ')}
            </div>
          </div>
        </ChartFrame>
      </div>
    </>
  )
}

function PartyTable({ view: v, side, loading, refreshing, onPick, picked }: { view: TradeView | null; side: TradeSide; loading: boolean; refreshing: boolean; onPick?: (key: string) => void; picked: string[] }) {
  const w = WORDS[side]
  const unit = v?.unit as Unit | null
  const qtyOf = (p: PartyRow) => (unit ? (unit === 'L' ? p.qty_l : p.qty_kg) : 0)
  const overall = v && unit ? avgRate(v.totals.amount, unit === 'L' ? v.totals.qty_l : v.totals.qty_kg) : null
  const total = v?.totals.amount ?? 0
  return (
    <>
      <SectionTitle title={`${w.parties} compared`} hint={onPick ? `click a ${w.party.toLowerCase()} to filter everything above by them` : `${w.parties.toLowerCase()} with the same GST number are added together across companies`} />
      <div className={`surface table-card ${refreshing ? 'refreshing' : 'settled'}`}>
        <Table<PartyRow>
          rowKey="key"
          size="middle"
          loading={loading && !v}
          dataSource={v?.parties}
          pagination={(v?.parties.length ?? 0) > 15 ? { pageSize: 15, showSizeChanger: false } : false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: `Nothing ${w.verb} in this period` }}
          onRow={(p) => (onPick ? { onClick: () => onPick(p.key), className: 'clickable' } : {})}
          columns={[
            {
              title: w.party,
              render: (_, p) => (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <b>{p.name}</b>
                  {p.city && <span className="faint">{p.city}</span>}
                  {picked.includes(p.key) && <Tag color="blue">Filtered</Tag>}
                </span>
              ),
            },
            { title: 'Bills', dataIndex: 'bills', align: 'right', sorter: (a, b) => a.bills - b.bills },
            { title: 'Quantity', align: 'right', sorter: (a, b) => a.qty_kg + a.qty_l - (b.qty_kg + b.qty_l), render: (_, p) => <span className="num">{unit ? formatQty(qtyOf(p), unit) : qtyText(p.qty_kg, p.qty_l)}</span> },
            { title: 'Amount', align: 'right', defaultSortOrder: 'descend', sorter: (a, b) => a.amount - b.amount, render: (_, p) => <span className="num strong">{formatINR(p.amount)}</span> },
            { title: 'Share', align: 'right', render: (_, p) => <span className="num">{formatPercent(total ? (p.amount / total) * 100 : 0)}</span> },
            ...(unit
              ? [
                  { title: 'Their average', align: 'right' as const, sorter: (a: PartyRow, b: PartyRow) => a.amount / (qtyOf(a) || 1) - b.amount / (qtyOf(b) || 1), render: (_: unknown, p: PartyRow) => <span className="num strong">{qtyOf(p) ? formatRateIn(p.amount / qtyOf(p), unit) : '—'}</span> },
                  {
                    title: <Tooltip title={side === 'purchase' ? 'Green: cheaper than the average of everyone' : 'Green: pays more than the average of everyone'}>vs everyone</Tooltip>,
                    align: 'right' as const,
                    render: (_: unknown, p: PartyRow) => {
                      if (!overall || !qtyOf(p)) return '—'
                      const diff = ((p.amount / qtyOf(p) - overall) / overall) * 100
                      const good = side === 'purchase' ? diff <= 0 : diff >= 0
                      return (
                        <span className="num strong" style={{ color: good ? '#1F9D6B' : '#D4380D' }}>
                          {diff <= 0 ? <ArrowDownOutlined /> : <ArrowUpOutlined />} {formatPercent(Math.abs(diff))}
                        </span>
                      )
                    },
                  },
                  { title: 'Lowest – highest', align: 'right' as const, render: (_: unknown, p: PartyRow) => <span className="num faint">{p.min_rate !== null && p.max_rate !== null ? `${formatRateIn(p.min_rate, unit)} – ${formatRateIn(p.max_rate, unit)}` : '—'}</span> },
                  { title: 'Last rate', align: 'right' as const, render: (_: unknown, p: PartyRow) => <span className="num">{p.last_rate !== null ? formatRateIn(p.last_rate, unit) : '—'}</span> },
                ]
              : []),
            { title: 'First bill', align: 'right', render: (_, p) => <span className="num faint">{formatDate(p.first_date)}</span> },
            { title: 'Last bill', align: 'right', sorter: (a, b) => a.last_date.localeCompare(b.last_date), render: (_, p) => <span className="num">{formatDate(p.last_date)}</span> },
          ]}
        />
      </div>
    </>
  )
}
