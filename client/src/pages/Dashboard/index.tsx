import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Empty, Timeline } from 'antd'
import { InboxOutlined, RightOutlined, RiseOutlined, ShopOutlined, ShoppingCartOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { totalOf } from '../../utils/stock'
import { KpiCard, PageHeader, SectionTitle } from '../../components/ui'
import { statusMeta } from '../../utils/entryStatus'
import { companyItems, itemName } from '../../data/catalog'
import OilKpiPanel from '../../components/charts/OilKpiPanel'
import { useOilKpi } from '../../hooks/queries/reports'
import { useEntries } from '../../hooks/queries/entries'
import { useAccess } from '../../hooks/useAccess'
import { useAuth } from '../../hooks/useAuth'
import { useCompanyData } from '../../hooks/useCompanyData'
import { brand, seriesColors } from '../../styles/theme'
import { formatDateShort, formatINRShort, formatPercent, formatTonnes, formatQty } from '../../utils/format'
import { bucketFor, periodLabels, rangeSubtitle } from '../../utils/period'
import { firstName } from '../../utils/user'
import DashboardCharts from './DashboardCharts'

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

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { active, activeAccess, canAnywhere, can } = useAccess()
  const { scope, period, range, raw, total: t } = useCompanyData()
  const several = scope.length > 1
  const viewing = active === 'all' ? `all ${scope.length} companies` : activeAccess?.company.name
  const rawKg = totalOf(raw)
  const rawFinal = totalOf(raw, 'confirmed')
  // CEO and Managers see the oil KPI for companies that make oil.
  const oilIds = useMemo(() => scope.filter((c) => can('view_oil_kpi', c.id) && companyItems(c).outputs.some((o) => o.id === 'oil')).map((c) => c.id), [scope, can])
  const oil = useOilKpi(oilIds, range)
  const hour = dayjs().hour()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const margin = (t?.sales.amount ?? 0) - (t?.purchases.amount ?? 0)
  const marginPct = t?.sales.amount ? (margin / t.sales.amount) * 100 : 0
  const queue = t ? t.queue.pending + t.queue.approved + t.queue.on_hold : 0


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
        <KpiCard label="Spent on purchases" value={formatINRShort(t?.purchases.amount ?? 0)} sub={`${formatINRShort(t?.purchases.verified_amount ?? 0)} checked by Finance`} icon={<ShoppingCartOutlined />} tone={{ bg: '#eef4fb', fg: seriesColors.purchase }} onClick={() => navigate('/purchases')} />
        <KpiCard label="Received from sales" value={formatINRShort(t?.sales.amount ?? 0)} sub={`${formatINRShort(t?.sales.verified_amount ?? 0)} checked by Finance`} icon={<ShopOutlined />} tone={{ bg: brand.primarySoft, fg: brand.primary }} onClick={() => navigate('/sales')} />
        <KpiCard
          label="Basic difference"
          value={formatINRShort(margin)}
          sub={`${formatPercent(marginPct)} of sales value`}
          icon={<RiseOutlined />}
          tone={{ bg: '#e6f5f3', fg: seriesColors.margin }}
          help="Sales money minus purchase money. Labour, power and transport costs are not included."
          onClick={() => navigate('/finance')}
        />
        <KpiCard label="Raw material in stock" value={formatTonnes(rawKg)} sub={`${formatTonnes(rawFinal)} checked by Finance`} icon={<InboxOutlined />} tone={{ bg: '#f1f2f5', fg: '#3a3f47' }} help="Stock as of now. The period you pick does not change this." onClick={() => navigate('/stock')} />
      </div>

      {oilIds.length > 0 && (
        <>
          <SectionTitle title="Oil KPI" hint="oil made ÷ weight processed · green: 40% or more · red: below 39%" />
          <OilKpiPanel kpi={oil.kpi} bucket={bucketFor(range)} loading={oil.isLoading} refreshing={oil.isRefreshing} />
        </>
      )}

      <DashboardCharts />

      <div style={{ marginTop: 12 }}>
        <RecentEntries companyIds={scope.map((c) => c.id)} />
      </div>
    </div>
  )
}
