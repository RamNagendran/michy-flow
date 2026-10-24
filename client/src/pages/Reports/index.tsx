import { useMemo } from 'react'
import CompanyPicker from '../../components/CompanyPicker'
import OilKpiPanel from '../../components/charts/OilKpiPanel'
import { MoneyTrend, ProductionTrend } from '../../components/charts/TrendCharts'
import { PageHeader, SectionTitle } from '../../components/ui'
import { companyItems, WASTAGE_ALERT_PCT } from '../../data/catalog'
import { useOilKpi, useTrends } from '../../hooks/queries/reports'
import { useAccess } from '../../hooks/useAccess'
import { usePeriod } from '../../hooks/usePeriod'
import { useReportCompany } from '../../hooks/useReportCompany'
import type { TrendPoint } from '../../types/reports'
import { formatINRShort, formatPercent, formatTonnes } from '../../utils/format'
import ProductionEfficiency from './ProductionEfficiency'

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="surface stat-tile lift">
      <div className="label">{label}</div>
      <div className="value num" style={{ color: tone }}>
        {value}
      </div>
      <div className="sub">{sub}</div>
    </div>
  )
}

/** Totals over the series, worked out once per data change. */
function totals(series: TrendPoint[]) {
  const t = series.reduce(
    (a, p) => ({
      sales: a.sales + p.sales_amount,
      purchases: a.purchases + p.purchase_amount,
      processed: a.processed + p.processed_kg,
      output: a.output + p.output_kg,
      wastage: a.wastage + p.wastage_kg,
    }),
    { sales: 0, purchases: 0, processed: 0, output: 0, wastage: 0 },
  )
  return { ...t, wastagePct: t.processed ? (t.wastage / t.processed) * 100 : 0 }
}

/** Trends for the companies in view, the oil KPI for the CEO and Managers, and shift efficiency. */
export default function Reports() {
  const { scope, can } = useAccess()
  const { label, range, subtitle } = usePeriod()
  const ids = useMemo(() => scope.filter((c) => can('view_all_entries', c.id)).map((c) => c.id), [scope, can])
  // Oil only for companies that make it, and only for people allowed to see the KPI.
  const oilIds = useMemo(() => scope.filter((c) => can('view_oil_kpi', c.id) && companyItems(c).outputs.some((o) => o.id === 'oil')).map((c) => c.id), [scope, can])
  const trends = useTrends(ids, range)
  const oil = useOilKpi(oilIds, range)
  const plant = useReportCompany('view_all_entries')
  const t = useMemo(() => totals(trends.series), [trends.series])

  return (
    <div className="page">
      <PageHeader title="Reports" subtitle={`${label} · ${subtitle} · ${ids.length > 1 ? `${ids.length} companies added together` : (scope.find((c) => c.id === ids[0])?.name ?? '')}`} />

      <div className="grid grid-4 stagger">
        <Tile label="Sales" value={formatINRShort(t.sales)} sub="before GST" />
        <Tile label="Purchases" value={formatINRShort(t.purchases)} sub="before GST" />
        <Tile label="Processed" value={formatTonnes(t.processed)} sub={`${formatTonnes(t.output)} came out`} />
        <Tile
          label="Wastage"
          value={formatPercent(t.wastagePct, 2)}
          sub={`${formatTonnes(t.wastage)} missing · limit ${WASTAGE_ALERT_PCT}%`}
          tone={t.wastagePct > WASTAGE_ALERT_PCT ? '#D4380D' : undefined}
        />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <MoneyTrend series={trends.series} bucket={trends.bucket} loading={trends.isLoading} refreshing={trends.isRefreshing} />
        <ProductionTrend series={trends.series} bucket={trends.bucket} loading={trends.isLoading} refreshing={trends.isRefreshing} />
      </div>

      {oilIds.length > 0 && (
        <>
          <SectionTitle title="Oil KPI" hint="CEO and Managers only" />
          <OilKpiPanel kpi={oil.kpi} bucket={trends.bucket} loading={oil.isLoading} refreshing={oil.isRefreshing} />
        </>
      )}

      {plant.companies.length > 0 && (
        <>
          <SectionTitle title="Production efficiency" hint="3 shifts a day" extra={<CompanyPicker companies={plant.companies} value={plant.company?.id} onChange={plant.setCompany} />} />
          <ProductionEfficiency companyId={plant.company?.id} range={range} />
        </>
      )}
    </div>
  )
}
