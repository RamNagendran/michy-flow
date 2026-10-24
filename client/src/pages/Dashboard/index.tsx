import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Empty, Timeline } from 'antd'
import { ExperimentOutlined, InboxOutlined, RightOutlined, RiseOutlined, ShopOutlined, ShoppingCartOutlined } from '@ant-design/icons'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import dayjs from 'dayjs'
import ChartTooltip from '../../components/ChartTooltip'
import { CompaniesTotalCard, CompanyCard } from '../../components/CompanyCards'
import { totalOf } from '../../utils/stock'
import { Formula, KpiCard, PageHeader, SectionTitle } from '../../components/ui'
import { statusMeta } from '../../utils/entryStatus'
import { companyItems, itemName, itemsOfCompanies, toKg } from '../../data/catalog'
import OilKpiPanel from '../../components/charts/OilKpiPanel'
import { useOilKpi } from '../../hooks/queries/reports'
import { useEntries } from '../../hooks/queries/entries'
import { useAccess } from '../../hooks/useAccess'
import { useAuth } from '../../hooks/useAuth'
import { useCompanyData } from '../../hooks/useCompanyData'
import { brand, seriesColors } from '../../styles/theme'
import { formatDateShort, formatINRShort, formatKg, formatPercent, formatTonnes, formatQty } from '../../utils/format'
import { bucketFor, periodLabels, rangeSubtitle } from '../../utils/period'
import { firstName } from '../../utils/user'

function RecentEntries({ companyIds }: { companyIds: number[] }) {
  const navigate = useNavigate()
  const recent = useEntries({ company_id: companyIds, page_size: 7 })
  return (
    <div className="surface" style={{ padding: '20px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="strong" style={{ fontSize: 16 }}>
          Latest entries
        </div>
        <Button type="link" onClick={() => navigate('/records')} style={{ paddingInline: 0 }}>
          All records
        </Button>
      </div>
      {recent.data?.items.length ? (
        <Timeline
          style={{ marginTop: 18 }}
          items={recent.data.items.map((r) => ({
            color: r.type === 'purchase' ? seriesColors.purchase : r.type === 'sale' ? brand.primary : '#3a3f47',
            title: (
              <span className="faint" style={{ fontSize: 12 }}>
                {formatDateShort(r.entry_date)} · {r.ref_no}
              </span>
            ),
            content: (
              <div style={{ marginTop: -2 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                  {r.type === 'purchase' ? 'Purchase' : r.type === 'sale' ? 'Sale' : 'Production'} · {itemName(r.item)}
                </div>
                <div className="muted num" style={{ fontSize: 12.5 }}>
                  {formatQty(r.qty, r.unit)} · {r.company_name}
                  {r.amount !== null && ` · ${formatINRShort(r.amount)}`} · <b>{statusMeta[r.status].label}</b>
                </div>
              </div>
            ),
          }))}
        />
      ) : (
        <Empty style={{ marginTop: 24 }} description="No entries yet" />
      )}
    </div>
  )
}

const color = (id: string) => seriesColors[id as keyof typeof seriesColors] ?? '#8a919e'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { active, activeAccess, canAnywhere, can } = useAccess()
  const { scope, period, range, stocks, raw, output, summaries, total: t } = useCompanyData()
  const several = scope.length > 1
  const viewing = active === 'all' ? `all ${scope.length} companies` : activeAccess?.company.name
  const rawKg = totalOf(raw)
  const rawFinal = totalOf(raw, 'confirmed')
  // CEO and Managers see the oil KPI for companies that make oil.
  const oilIds = useMemo(() => scope.filter((c) => can('view_oil_kpi', c.id) && companyItems(c).outputs.some((o) => o.id === 'oil')).map((c) => c.id), [scope, can])
  const oil = useOilKpi(oilIds, range)
  const hour = dayjs().hour()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // In each product's unit; the chart compares them by weight.
  const produced = (id: string) => t?.production.by_item.find((i) => i.item === id)?.qty ?? 0
  const products = itemsOfCompanies(scope, 'products')
  const sold = (id: string) => t?.sales.by_item.find((i) => i.item === id)
  const margin = (t?.sales.amount ?? 0) - (t?.purchases.amount ?? 0)
  const marginPct = t?.sales.amount ? (margin / t.sales.amount) * 100 : 0
  const queue = t ? t.queue.pending + t.queue.approved + t.queue.on_hold : 0

  const flow = [
    { title: 'Purchased', value: formatTonnes(t?.purchases.qty_kg ?? 0), sub: `${formatINRShort(t?.purchases.amount ?? 0)} · ${t?.purchases.count ?? 0} bills`, to: '/purchases', icon: <ShoppingCartOutlined /> },
    { title: 'Raw material in stock now', value: formatTonnes(rawKg), sub: `${formatTonnes(rawFinal)} finalised`, to: '/stock', icon: <InboxOutlined /> },
    { title: 'Processed', value: formatTonnes(t?.production.input_kg ?? 0), sub: `${t?.production.count ?? 0} production entries`, to: '/production', icon: <ExperimentOutlined /> },
    { title: 'Produced', value: formatTonnes(t?.production.output_kg ?? 0), sub: `Wastage ${formatTonnes(t?.production.wastage_kg ?? 0)}`, to: '/stock', icon: <RiseOutlined /> },
    { title: 'Sold', value: formatTonnes(t?.sales.qty_kg ?? 0), sub: `${t?.sales.qty_l ? `${formatQty(t.sales.qty_l, 'L')} oil · ` : ''}${formatINRShort(t?.sales.amount ?? 0)} · ${t?.sales.count ?? 0} invoices`, to: '/sales', icon: <ShopOutlined /> },
  ]

  return (
    <div className="page">
      <PageHeader
        eyebrow={dayjs().format('dddd, D MMMM YYYY')}
        title={`${greeting}, ${firstName(user)}`}
        subtitle={
          <>
            Here's how <b>{viewing}</b> {several ? 'are' : 'is'} doing — {periodLabels[period].toLowerCase()} ({rangeSubtitle(range)}). Figures include entries still
            waiting for approval.
          </>
        }
      />

      {queue > 0 && (
        <Alert
          type={t!.queue.on_hold ? 'error' : 'warning'}
          showIcon
          style={{ marginBottom: 16, borderRadius: 12 }}
          title={`${queue} ${queue === 1 ? 'entry is' : 'entries are'} not final yet`}
          description={`${t!.queue.pending} waiting for the Admin · ${t!.queue.approved} waiting for Finance · ${t!.queue.on_hold} on hold`}
          action={
            canAnywhere('approve_entry', 'verify_entry') && (
              <Button onClick={() => navigate('/review')}>
                Open approvals <RightOutlined />
              </Button>
            )
          }
        />
      )}

      <div className="grid grid-4">
        <KpiCard label="Spent on purchases" value={formatINRShort(t?.purchases.amount ?? 0)} sub={`${formatINRShort(t?.purchases.verified_amount ?? 0)} verified by Finance`} icon={<ShoppingCartOutlined />} tone={{ bg: '#eef4fb', fg: seriesColors.purchase }} onClick={() => navigate('/purchases')} />
        <KpiCard label="Received from sales" value={formatINRShort(t?.sales.amount ?? 0)} sub={`${formatINRShort(t?.sales.verified_amount ?? 0)} verified by Finance`} icon={<ShopOutlined />} tone={{ bg: brand.primarySoft, fg: brand.primary }} onClick={() => navigate('/sales')} />
        <KpiCard
          label="Basic difference"
          value={formatINRShort(margin)}
          sub={`${formatPercent(marginPct)} of sales value`}
          icon={<RiseOutlined />}
          tone={{ bg: '#e6f5f3', fg: seriesColors.margin }}
          help="Sales received minus purchases spent. Labour, electricity and transport costs are not included."
          onClick={() => navigate('/finance')}
        />
        <KpiCard label="Raw material in stock" value={formatTonnes(rawKg)} sub={`${formatTonnes(rawFinal)} finalised by Finance`} icon={<InboxOutlined />} tone={{ bg: '#f1f2f5', fg: '#3a3f47' }} help="Stock right now, whatever period is selected." onClick={() => navigate('/stock')} />
      </div>

      {oilIds.length > 0 && (
        <>
          <SectionTitle title="Oil KPI" hint="oil out ÷ weight processed · green at 40%+, red under 39%" />
          <OilKpiPanel kpi={oil.kpi} bucket={bucketFor(range)} loading={oil.isLoading} refreshing={oil.isRefreshing} />
        </>
      )}

      <SectionTitle title="How material moved" hint={`${periodLabels[period]} · click any step for details`} />
      <div className="surface flow">
        {flow.map((f, i) => (
          <div key={f.title} className="flow-step" onClick={() => navigate(f.to)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="step-no">{i + 1}</span>
              <span className="step-title">{f.title}</span>
            </div>
            <div className="step-value">{f.value}</div>
            <div className="step-sub">{f.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', marginTop: 16 }}>
        <div className="surface" style={{ padding: 22 }}>
          <div className="strong" style={{ fontSize: 16 }}>
            Money in and out
          </div>
          <div className="faint" style={{ fontSize: 13, marginBottom: 16 }}>
            {periodLabels[period]} · all figures before GST
          </div>
          <Formula
            parts={[
              { label: `Received from sales · ${t?.sales.count ?? 0} invoices`, value: formatINRShort(t?.sales.amount ?? 0), kind: 'in' },
              { op: '−', label: `Spent on purchases · ${t?.purchases.count ?? 0} bills`, value: formatINRShort(t?.purchases.amount ?? 0), kind: 'out' },
              { op: '=', label: 'Basic difference', value: formatINRShort(margin), kind: 'result' },
            ]}
          />
          <div className="faint" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '22px 0 10px' }}>
            Sales by product
          </div>
          {products.map((o) => {
            const s = sold(o.id)
            return (
              <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 190px', alignItems: 'center', gap: 14, padding: '7px 0' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                  <span className="legend-dot" style={{ background: color(o.id) }} />
                  {o.name}
                </span>
                <div style={{ height: 10, borderRadius: 99, background: '#eef0f3', overflow: 'hidden' }}>
                  <div style={{ width: `${((s?.amount ?? 0) / (t?.sales.amount || 1)) * 100}%`, height: '100%', background: color(o.id), borderRadius: 99 }} />
                </div>
                <span className="num" style={{ textAlign: 'right' }}>
                  <b>{formatINRShort(s?.amount ?? 0)}</b>
                  <span className="faint" style={{ marginLeft: 8 }}>
                    {o.unit === 'L' ? formatQty(s?.qty ?? 0, 'L') : formatTonnes(s?.qty ?? 0)}
                  </span>
                </span>
              </div>
            )
          })}
        </div>

        <div className="surface" style={{ padding: 22, display: 'flex', flexDirection: 'column' }}>
          <div className="strong" style={{ fontSize: 16 }}>
            What we produced
          </div>
          <div className="faint" style={{ fontSize: 13 }}>
            {periodLabels[period]}
          </div>
          <div style={{ height: 190, position: 'relative', marginTop: 8 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={products.map((o) => ({ name: o.name, value: toKg(o.id, produced(o.id)) }))} isAnimationActive={false} dataKey="value" nameKey="name" innerRadius={62} outerRadius={86} paddingAngle={2} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270}>
                  {products.map((o) => (
                    <Cell key={o.id} fill={color(o.id)} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip format={(v) => formatKg(v)} />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="num strong" style={{ fontSize: 22 }}>
                  {formatTonnes(t?.production.output_kg ?? 0)}
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  total output
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 'auto' }}>
            {products.map((o) => (
              <div className="mat-row" key={o.id}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="legend-dot" style={{ background: color(o.id) }} />
                  {o.name}
                </span>
                <span className="num">
                  <b>{formatQty(produced(o.id), o.unit)}</b>
                  <span className="faint" style={{ marginLeft: 8 }}>
                    {formatPercent((toKg(o.id, produced(o.id)) / (t?.production.output_kg || 1)) * 100, 0)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <SectionTitle
        title={several ? 'Companies' : 'Stock'}
        hint="Stock right now"
        extra={
          <Button type="link" onClick={() => navigate('/stock')}>
            All stock <RightOutlined />
          </Button>
        }
      />
      <div className="grid grid-4">
        {scope.map((c) => (
          <CompanyCard key={c.id} company={c} raw={stocks.get(c.id)?.raw} output={stocks.get(c.id)?.output} summary={summaries.get(c.id)} />
        ))}
        {several && <CompaniesTotalCard count={scope.length} raw={raw} output={output} producedKg={t?.production.output_kg} />}
      </div>

      <div style={{ marginTop: 32 }}>
        <RecentEntries companyIds={scope.map((c) => c.id)} />
      </div>
    </div>
  )
}
